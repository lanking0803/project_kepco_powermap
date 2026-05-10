"""
KEPCO 차단 응답 패턴 탐지 테스트
========================================
목적
----
- 같은 IP 에서 5병렬(서울/경기도/강원/전남/전북)로 KEPCO 추출 시 차단 발생 여부 확인
- 차단 시 KEPCO 가 어떤 응답을 주는지 패턴 캡처 (HTTP 코드, 헤더, 본문 prefix, JSON 구조)
- 응답 시간 변화 추적 (차단 직전 신호 후보)

설계
----
- 5스레드 동시 실행, 각 스레드는 시도 1개 담당 (서울/경기도/강원/전남/전북)
- 각 스레드는 시도 → 시군구 → 동/면 → 리 → 번지 → 용량검색 흐름을 무한 반복
  (1시간 동안 끝까지 안 끝나도 OK, 끝나면 다음 시군구로)
- API 호출 응답 수신 후 0.5초 대기 (운영 코드와 동일)
- 1시간 후 자동 종료
- 모든 비정상 응답 (HTTP 에러 / JSON 파싱 실패 / 200 OK + 빈 결과 등) 을
  results/probe_<timestamp>.jsonl 에 한 줄씩 기록
- 5분 간격으로 stdout 에 누적 통계 출력

차단 판정 후보
--------------
1. HTTP 4xx/5xx (특히 403/429/503)
2. 200 OK + HTML body (Content-Type 변화)
3. 200 OK + JSON 인데 빈 dlt_* (이건 정상일 수도 있음 — 정상 패턴과 비교 필요)
4. 응답 시간 폭증 (예: 평균 0.3초 → 5초+)
5. 연결 거부 / TLS handshake 실패 / 타임아웃 폭증

실행
----
PowerShell (프로젝트 루트):
  cd "e:/2. hicor/Python/project_kepco_powermap"
  python crawler/test/kepco_block_probe.py

또는 백그라운드:
  Start-Process python -ArgumentList "crawler/test/kepco_block_probe.py" -RedirectStandardOutput "crawler/test/results/run.log" -NoNewWindow
"""

import json
import os
import random
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

# crawler/ 모듈 import 가능하게 path 추가 (crawler/test/ → crawler/)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests
from api_client import KepcoApiClient, BASE_URL, HEADERS, USER_AGENTS

# ── 설정 ──
# 병렬도 임계 측정 — 라운드별 단계 증가
#   라운드 1 (완료): 1병렬 [서울]                            → 0% (avg 366ms)
#   라운드 2 (완료): 2병렬 [부산, 대구] 0.5초                → 0% (avg 43ms)
#   라운드 3 (완료): 3병렬 [인천, 대전, 광주] 0.5초          → 0% (avg 42ms)
#   라운드 4 (완료): 4병렬 [울산, 세종, 충북, 충남] 0.5초    → 0% (avg 43ms)
#   라운드 5 (완료): 5병렬 [경북, 경남, 제주, 부산, 대구] 0.5초 → 60% 차단
#   라운드 6 (완료): 5병렬 [서울, 경기, 강원, 전남, 전북] 1.0초 → 0% ⭐ "회전율 가설" 강력 지지
#   라운드 7 (현재): 10병렬 1.0초 ← 동시성 2배·분당 절반 (~565건/분) — 동시 in-flight 가설 확정 폐기
TARGET_SIDOS = [
    "서울특별시", "경기도", "강원특별자치도", "전라남도", "전라북도",
    "부산광역시", "대구광역시", "인천광역시", "대전광역시", "광주광역시",
]
DURATION_SEC = 180              # 3분
DELAY_AFTER_RESPONSE = 1.0      # 0.5 → 1.0초 유지
STATUS_REPORT_INTERVAL_SEC = 30 # 30초마다 stdout 통계 (3분 짧음)
HTTP_TIMEOUT_SEC = 10           # Ctrl+C 즉시 반응 위해 30→10 단축
RESULTS_DIR = Path(__file__).resolve().parent / "results"
RESULTS_DIR.mkdir(exist_ok=True)

RUN_TS = datetime.now().strftime("%Y%m%d_%H%M%S")
ANOMALY_LOG = RESULTS_DIR / f"probe_{RUN_TS}_anomalies.jsonl"
ALL_REQ_LOG = RESULTS_DIR / f"probe_{RUN_TS}_requests.jsonl"
SUMMARY_LOG = RESULTS_DIR / f"probe_{RUN_TS}_summary.txt"

# ── 시도별 통계 (스레드 안전) ──
stats_lock = threading.Lock()
stats: dict[str, dict] = {}
file_lock = threading.Lock()
stop_event = threading.Event()


def log_anomaly(record: dict):
    """비정상 응답 기록"""
    with file_lock:
        with ANOMALY_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")


def log_request(record: dict):
    """모든 요청 기록 (응답 시간 추이 분석용)"""
    with file_lock:
        with ALL_REQ_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")


def make_session() -> requests.Session:
    """KEPCO 호출용 세션 (운영 코드와 동일 헤더)"""
    s = requests.Session()
    ua = random.choice(USER_AGENTS)
    s.headers.update({**HEADERS, "User-Agent": ua})
    try:
        s.get(f"{BASE_URL}/EWM092D00", timeout=HTTP_TIMEOUT_SEC)
    except Exception:
        pass
    return s


def kepco_post(session: requests.Session, sido: str, path: str, body: dict) -> tuple[dict | None, dict]:
    """
    POST 호출 → (parsed_json | None, meta) 반환
    meta = {status, elapsed_ms, content_type, body_prefix, error}
    """
    url = f"{BASE_URL}{path}"
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    started = time.time()
    meta = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "sido": sido,
        "path": path,
        "status": None,
        "elapsed_ms": None,
        "content_type": None,
        "body_prefix": None,
        "json_ok": False,
        "error": None,
    }
    try:
        resp = session.post(url, data=payload, timeout=HTTP_TIMEOUT_SEC)
        meta["elapsed_ms"] = int((time.time() - started) * 1000)
        meta["status"] = resp.status_code
        meta["content_type"] = resp.headers.get("Content-Type", "")
        body_text = resp.text or ""
        meta["body_prefix"] = body_text[:300]
        if resp.status_code != 200:
            return None, meta
        try:
            parsed = resp.json()
            meta["json_ok"] = True
            return parsed, meta
        except Exception as e:
            meta["error"] = f"json_parse: {e}"
            return None, meta
    except requests.exceptions.RequestException as e:
        meta["elapsed_ms"] = int((time.time() - started) * 1000)
        meta["error"] = f"{type(e).__name__}: {e}"
        return None, meta


def is_anomaly(meta: dict) -> bool:
    """비정상 응답 판정"""
    if meta["error"]:
        return True
    if meta["status"] != 200:
        return True
    if not meta["json_ok"]:
        return True
    ct = (meta["content_type"] or "").lower()
    if "json" not in ct:
        # KEPCO 정상은 application/json 계열
        return True
    if meta["elapsed_ms"] is not None and meta["elapsed_ms"] > 10000:
        # 10초 초과 — 차단 직전 신호 후보
        return True
    return False


def update_stats(sido: str, meta: dict):
    with stats_lock:
        s = stats.setdefault(sido, {
            "total": 0, "ok": 0, "anomaly": 0,
            "elapsed_sum_ms": 0, "elapsed_max_ms": 0,
            "by_status": {},
            "last_anomaly": None,
        })
        s["total"] += 1
        if is_anomaly(meta):
            s["anomaly"] += 1
            s["last_anomaly"] = meta["ts"]
        else:
            s["ok"] += 1
        if meta["elapsed_ms"] is not None:
            s["elapsed_sum_ms"] += meta["elapsed_ms"]
            if meta["elapsed_ms"] > s["elapsed_max_ms"]:
                s["elapsed_max_ms"] = meta["elapsed_ms"]
        st = str(meta["status"])
        s["by_status"][st] = s["by_status"].get(st, 0) + 1


def post_with_log(session: requests.Session, sido: str, path: str, body: dict) -> dict | None:
    """POST + 로깅 + 통계 + 0.5초 대기"""
    parsed, meta = kepco_post(session, sido, path, body)
    log_request(meta)
    update_stats(sido, meta)
    if is_anomaly(meta):
        log_anomaly(meta)
    time.sleep(DELAY_AFTER_RESPONSE)
    return parsed


def crawl_sido_loop(sido: str):
    """
    단일 시도 무한 루프 — 시군구→동→리→번지→용량검색
    1시간 stop_event 까지 끝까지 진행
    """
    session = make_session()
    print(f"[{sido}] 시작")

    while not stop_event.is_set():
        # 시군구 목록
        si_data = post_with_log(session, sido, "/ew/cpct/retrieveAddrGbn", {
            "dma_addrGbn": {
                "gbn": "0", "addr_do": sido, "addr_si": "", "addr_gu": "",
                "addr_lidong": "", "addr_li": "", "addr_jibun": "",
            }
        })
        if not si_data:
            continue
        si_list = [x.get("ADDR_SI", "") for x in si_data.get("dlt_addrGbn", [])]
        if not si_list:
            si_list = [""]

        for si in si_list:
            if stop_event.is_set():
                break
            gu_data = post_with_log(session, sido, "/ew/cpct/retrieveAddrGbn", {
                "dma_addrGbn": {
                    "gbn": "1", "addr_do": sido, "addr_si": si, "addr_gu": "",
                    "addr_lidong": "", "addr_li": "", "addr_jibun": "",
                }
            })
            if not gu_data:
                continue
            gu_list = [x.get("ADDR_GU", "") for x in gu_data.get("dlt_addrGbn", [])] or [""]

            for gu in gu_list:
                if stop_event.is_set():
                    break
                dong_data = post_with_log(session, sido, "/ew/cpct/retrieveAddrGbn", {
                    "dma_addrGbn": {
                        "gbn": "2", "addr_do": sido, "addr_si": si, "addr_gu": gu,
                        "addr_lidong": "", "addr_li": "", "addr_jibun": "",
                    }
                })
                if not dong_data:
                    continue
                dong_list = [x.get("ADDR_LIDONG", "") for x in dong_data.get("dlt_addrGbn", [])] or [""]

                for dong in dong_list:
                    if stop_event.is_set():
                        break
                    li_data = post_with_log(session, sido, "/ew/cpct/retrieveAddrGbn", {
                        "dma_addrGbn": {
                            "gbn": "3", "addr_do": sido, "addr_si": si, "addr_gu": gu,
                            "addr_lidong": dong, "addr_li": "", "addr_jibun": "",
                        }
                    })
                    if not li_data:
                        continue
                    li_list = [x.get("ADDR_LI", "") for x in li_data.get("dlt_addrGbn", [])] or [""]

                    for li in li_list:
                        if stop_event.is_set():
                            break
                        jibun_data = post_with_log(session, sido, "/ew/cpct/retrieveAddrGbn", {
                            "dma_addrGbn": {
                                "gbn": "4", "addr_do": sido, "addr_si": si, "addr_gu": gu,
                                "addr_lidong": dong, "addr_li": li, "addr_jibun": "",
                            }
                        })
                        if not jibun_data:
                            continue
                        jibun_list = [x.get("ADDR_JIBUN", "") for x in jibun_data.get("dlt_addrGbn", [])]
                        if not jibun_list:
                            continue

                        # 번지마다 용량 검색 (운영과 동일한 패턴)
                        for jibun in jibun_list:
                            if stop_event.is_set():
                                break
                            post_with_log(session, sido, "/ew/cpct/retrieveMeshNo", {
                                "dma_reqParam": {
                                    "searchCondition": "address",
                                    "do": sido, "si": si, "gu": gu,
                                    "lidong": dong, "li": li, "jibun": jibun,
                                }
                            })
    print(f"[{sido}] 종료")


def status_reporter():
    """주기적 stdout 통계"""
    started = time.time()
    while not stop_event.is_set():
        if stop_event.wait(STATUS_REPORT_INTERVAL_SEC):
            break
        elapsed = int(time.time() - started)
        print(f"\n=== 경과 {elapsed//60}분 {elapsed%60}초 ===")
        with stats_lock:
            for sido, s in stats.items():
                avg = (s["elapsed_sum_ms"] / s["total"]) if s["total"] else 0
                anomaly_pct = (s["anomaly"] / s["total"] * 100) if s["total"] else 0
                print(f"  [{sido}] req={s['total']} ok={s['ok']} anomaly={s['anomaly']} ({anomaly_pct:.1f}%) "
                      f"avg={avg:.0f}ms max={s['elapsed_max_ms']}ms status={s['by_status']}")


def write_summary():
    """종료 시 최종 요약 파일"""
    with stats_lock:
        lines = [
            f"KEPCO 차단 탐지 테스트 결과",
            f"실행 시각: {RUN_TS}",
            f"경과 시간: {DURATION_SEC} 초",
            f"호출 간 지연: {DELAY_AFTER_RESPONSE} 초",
            f"대상 시도: {', '.join(TARGET_SIDOS)}",
            "",
            "=" * 60,
        ]
        total_req = sum(s["total"] for s in stats.values())
        total_anom = sum(s["anomaly"] for s in stats.values())
        lines.append(f"전체 요청: {total_req}, 비정상: {total_anom} ({total_anom/total_req*100 if total_req else 0:.2f}%)")
        lines.append("")
        for sido, s in stats.items():
            avg = (s["elapsed_sum_ms"] / s["total"]) if s["total"] else 0
            anomaly_pct = (s["anomaly"] / s["total"] * 100) if s["total"] else 0
            lines.append(f"[{sido}]")
            lines.append(f"  요청: {s['total']}")
            lines.append(f"  정상: {s['ok']}")
            lines.append(f"  비정상: {s['anomaly']} ({anomaly_pct:.2f}%)")
            lines.append(f"  평균 응답: {avg:.0f} ms")
            lines.append(f"  최대 응답: {s['elapsed_max_ms']} ms")
            lines.append(f"  상태코드 분포: {s['by_status']}")
            lines.append(f"  마지막 비정상: {s['last_anomaly']}")
            lines.append("")
        SUMMARY_LOG.write_text("\n".join(lines), encoding="utf-8")
        print("\n" + "\n".join(lines))


def main():
    print(f"=== KEPCO 차단 탐지 테스트 시작 ===")
    print(f"대상: {TARGET_SIDOS}")
    print(f"지속 시간: {DURATION_SEC}초 ({DURATION_SEC//60}분)")
    print(f"호출 간 지연: {DELAY_AFTER_RESPONSE}초")
    print(f"로그 위치: {RESULTS_DIR}")
    print(f"  - 모든 요청: {ALL_REQ_LOG.name}")
    print(f"  - 비정상만: {ANOMALY_LOG.name}")
    print(f"  - 최종 요약: {SUMMARY_LOG.name}")
    print()

    threads = [threading.Thread(target=crawl_sido_loop, args=(sido,), name=f"thr-{sido}", daemon=True)
               for sido in TARGET_SIDOS]
    reporter = threading.Thread(target=status_reporter, name="reporter", daemon=True)

    for t in threads:
        t.start()
    reporter.start()

    try:
        # 짧은 polling 으로 sleep — KeyboardInterrupt 즉시 반응
        end = time.time() + DURATION_SEC
        while time.time() < end:
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n[Ctrl+C] 조기 종료 요청")
    finally:
        stop_event.set()
        print(f"\n[종료 신호 발송] 진행 중인 호출 끝나면 정리됩니다 (최대 {HTTP_TIMEOUT_SEC + 2}초)...")
        for t in threads:
            t.join(timeout=HTTP_TIMEOUT_SEC + 2)
        reporter.join(timeout=2)
        write_summary()
        print(f"\n=== 종료 ===")
        print(f"요약 파일: {SUMMARY_LOG}")


if __name__ == "__main__":
    main()
