"""
bjd_master 좌표 채우기 — VWorld data API 기반

대상:
  bjd_master WHERE lat IS NULL
  (L1 시도 / L2 시군구 / L3 읍면동 / L4 리 전부 가능)

동작:
  bjd_code 의 숫자 구조로 레이어 자동 선택 → VWorld data API GetFeature →
  응답 폴리곤 GeoJSON → shapely representative_point() (폴리곤 내부 보장) →
  lat/lng UPDATE

왜 data API 인가 (search 아님):
  bjd_master 의 PK = bjd_code. 외부 API 도 bjd_code 로 직접 조회해야 불일치 0.
  search API 는 평문 주소 검색 → 첫 지번 좌표 반환 → L3 읍/면에서 부정확.

레이어 매핑:
  L1 시/도     LT_C_ADSIDO_INFO   ctprvn_cd   bjd_code[:2]
  L2 시/군/구  LT_C_ADSIGG_INFO   sig_cd      bjd_code[:5]
  L3 읍/면/동  LT_C_ADEMD_INFO    emd_cd      bjd_code[:8]
  L4 리       LT_C_ADRI_INFO     li_cd       bjd_code[:10]

출력 파일 (모두 같은 timestamp, Windows 는 C:/cache/project_kepco_powermap/fill_bjd/):
  fill_bjd_run_<ts>.log
  fill_bjd_errors_<ts>.jsonl
  fill_bjd_summary_<ts>.json

중단/재개:
  SIGTERM/SIGINT → 현재 반복 후 summary 기록 → 안전 exit
  재실행 시 `lat IS NULL` 필터로 남은 행만 자동 재개

실행:
  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... VWORLD_KEY=... python fill_bjd_coords.py
  FILL_LIMIT=10 ...       # 테스트
  VWORLD_DELAY=0.5 ...    # 딜레이 조정 (기본 0.3)
"""
import json
import logging
import os
import random
import signal
import sys
import time
from datetime import datetime, timezone

import requests
from shapely.geometry import shape

# Windows cp949 회피
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
VWORLD_KEY = os.environ.get("VWORLD_KEY", "")

VWORLD_DATA_URL = "https://api.vworld.kr/req/data"
VWORLD_DELAY = float(os.environ.get("VWORLD_DELAY", "0.3"))
FILL_LIMIT = int(os.environ.get("FILL_LIMIT", "0"))
TIMEOUT = 20

RUN_TS = datetime.now().strftime("%Y%m%d_%H%M%S")
# Windows 로컬은 Google Drive 위 프로젝트 밖에 쓴다. 그 외(서버)는 현재 폴더
OUT_DIR = r"C:\cache\project_kepco_powermap\fill_bjd" if os.name == "nt" else "."
os.makedirs(OUT_DIR, exist_ok=True)
LOG_PATH = os.path.join(OUT_DIR, f"fill_bjd_run_{RUN_TS}.log")
ERR_PATH = os.path.join(OUT_DIR, f"fill_bjd_errors_{RUN_TS}.jsonl")
NAME_DIFF_PATH = os.path.join(OUT_DIR, f"fill_bjd_name_diff_{RUN_TS}.jsonl")  # 행안부 vs VWorld 한글명 불일치
SUM_PATH = os.path.join(OUT_DIR, f"fill_bjd_summary_{RUN_TS}.json")

# ─────────────────────────────────────────────
# 로깅
# ─────────────────────────────────────────────
logger = logging.getLogger("fill_bjd")
logger.setLevel(logging.INFO)
_fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%H:%M:%S")

_ch = logging.StreamHandler(sys.stdout)
_ch.setFormatter(_fmt)
logger.addHandler(_ch)

_fh = logging.FileHandler(LOG_PATH, encoding="utf-8")
_fh.setFormatter(_fmt)
logger.addHandler(_fh)

# ─────────────────────────────────────────────
# 종료 신호
# ─────────────────────────────────────────────
_shutdown = False
_shutdown_reason = None


def _handle_term(sig, frame):
    global _shutdown, _shutdown_reason
    _shutdown = True
    _shutdown_reason = "SIGTERM" if sig == signal.SIGTERM else "SIGINT"
    logger.warning(f"[{_shutdown_reason}] 종료 신호 — 현재 반복 후 정리")


signal.signal(signal.SIGTERM, _handle_term)
signal.signal(signal.SIGINT, _handle_term)

# ─────────────────────────────────────────────
# 에러 JSONL append
# ─────────────────────────────────────────────
_err_fp = None
_name_fp = None


def _err_append(entry):
    global _err_fp
    if _err_fp is None:
        _err_fp = open(ERR_PATH, "a", encoding="utf-8")
    _err_fp.write(json.dumps(entry, ensure_ascii=False) + "\n")
    _err_fp.flush()


def _name_diff_append(entry):
    global _name_fp
    if _name_fp is None:
        _name_fp = open(NAME_DIFF_PATH, "a", encoding="utf-8")
    _name_fp.write(json.dumps(entry, ensure_ascii=False) + "\n")
    _name_fp.flush()


def _close_all():
    global _err_fp, _name_fp
    if _err_fp is not None:
        _err_fp.close()
        _err_fp = None
    if _name_fp is not None:
        _name_fp.close()
        _name_fp = None


# ─────────────────────────────────────────────
# bjd_code → 레이어/필드/값 매핑
# ─────────────────────────────────────────────
def layer_of(bjd_code: str):
    """bjd_code 10자리 → (layer_name, attr_field, attr_value, level)."""
    if bjd_code[2:] == "0" * 8:
        return "LT_C_ADSIDO_INFO", "ctprvn_cd", bjd_code[:2], 1
    if bjd_code[5:] == "0" * 5:
        return "LT_C_ADSIGG_INFO", "sig_cd", bjd_code[:5], 2
    if bjd_code[8:] == "00":
        return "LT_C_ADEMD_INFO", "emd_cd", bjd_code[:8], 3
    return "LT_C_ADRI_INFO", "li_cd", bjd_code, 4


# ─────────────────────────────────────────────
# VWorld data API GetFeature → centroid
# ─────────────────────────────────────────────
def vworld_centroid(layer: str, attr_field: str, attr_value: str, level: int):
    """폴리곤 조회 → (lat, lng, vw_name) 또는 (None, err).

    vw_name:
      L1 → ctp_kor_nm (예: '서울특별시')
      L2~L4 → full_nm (예: '부산광역시 기장군 기장읍 동부리')
    """
    params = {
        "service": "data",
        "request": "GetFeature",
        "data": layer,
        "key": VWORLD_KEY,
        "attrFilter": f"{attr_field}:=:{attr_value}",
        "geometry": "true",
        "crs": "EPSG:4326",
        "format": "json",
        "size": "10",
    }
    try:
        r = requests.get(
            VWORLD_DATA_URL,
            params=params,
            headers={"Referer": "https://sunlap.kr"},
            timeout=TIMEOUT,
        )
        if r.status_code != 200:
            return None, f"HTTP {r.status_code}"
        data = r.json()
        status = data.get("response", {}).get("status")
        if status != "OK":
            return None, f"status={status}"
        result = data.get("response", {}).get("result") or {}
        fc = result.get("featureCollection") or {}
        features = fc.get("features") or []
        if not features:
            return None, "no features"

        # 단일 매칭 가정. 여러 개면 첫 feature 쓰되 geometry 병합은 생략 (첫 항목이 대표)
        feat = features[0]
        geom = feat.get("geometry")
        if not geom:
            return None, "no geometry"
        try:
            poly = shape(geom)
        except Exception as e:
            return None, f"shape parse: {e}"

        if poly.is_empty:
            return None, "empty geometry"
        if not poly.is_valid:
            poly = poly.buffer(0)
            if not poly.is_valid or poly.is_empty:
                return None, "invalid geometry"

        p = poly.representative_point()

        props = feat.get("properties") or {}
        vw_name = props.get("ctp_kor_nm") if level == 1 else props.get("full_nm")

        return (p.y, p.x, vw_name), None

    except requests.exceptions.RequestException as e:
        return None, f"req error: {e}"
    except Exception as e:
        return None, f"unknown: {e}"


# ─────────────────────────────────────────────
# Supabase
# ─────────────────────────────────────────────
def _headers(prefer=""):
    h = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        h["Prefer"] = prefer
    return h


def fetch_targets(limit=0):
    """bjd_master WHERE lat IS NULL. sep_1~5 도 함께 가져와 VWorld 응답과 한글명 비교."""
    rows = []
    page = 1000
    offset = 0
    while True:
        params = {
            "select": "bjd_code,sep_1,sep_2,sep_3,sep_4,sep_5",
            "lat": "is.null",
            "order": "bjd_code",
            "limit": str(page),
            "offset": str(offset),
        }
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/bjd_master",
            params=params,
            headers=_headers(),
            timeout=30,
        )
        if r.status_code != 200:
            logger.error(f"DB 조회 실패: {r.status_code} {r.text[:200]}")
            break
        data = r.json()
        if not data:
            break
        rows.extend(data)
        if len(data) < page:
            break
        offset += page
        if limit > 0 and len(rows) >= limit:
            break
    return rows[:limit] if limit > 0 else rows


def update_row(bjd_code, lat, lng):
    try:
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/bjd_master",
            params={"bjd_code": f"eq.{bjd_code}"},
            json={
                "lat": lat,
                "lng": lng,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            headers=_headers("return=minimal"),
            timeout=15,
        )
        return r.status_code in (200, 204)
    except Exception as e:
        logger.warning(f"UPDATE 예외 (bjd={bjd_code}): {e}")
        return False


def write_summary(stats, target_count, processed, started_iso, elapsed, status):
    summary = {
        "run_ts": RUN_TS,
        "started_at": started_iso,
        "ended_at": datetime.now(timezone.utc).isoformat(),
        "completion_status": status,
        "target_count": target_count,
        "processed_count": processed,
        "elapsed_seconds": int(elapsed),
        "stats": stats,
        "fill_limit": FILL_LIMIT,
        "files": {"log": LOG_PATH, "errors_jsonl": ERR_PATH, "summary": SUM_PATH},
    }
    with open(SUM_PATH, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)


def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        logger.error("SUPABASE_URL / SUPABASE_SERVICE_KEY 필수")
        sys.exit(1)
    if not VWORLD_KEY:
        logger.error("VWORLD_KEY 필수")
        sys.exit(1)

    started = time.time()
    started_iso = datetime.now(timezone.utc).isoformat()
    if FILL_LIMIT > 0:
        logger.info(f"[테스트] 처음 {FILL_LIMIT} 건")

    logger.info(f"로그: {LOG_PATH}")
    logger.info(f"에러: {ERR_PATH}")
    logger.info(f"요약: {SUM_PATH}")

    logger.info("bjd_master 에서 lat NULL 인 행 조회...")
    targets = fetch_targets(FILL_LIMIT)
    logger.info(f"대상: {len(targets):,} 건, 딜레이 {VWORLD_DELAY}초")

    stats = {
        "L1_ok": 0, "L2_ok": 0, "L3_ok": 0, "L4_ok": 0,
        "L1_fail": 0, "L2_fail": 0, "L3_fail": 0, "L4_fail": 0,
        "update_failed": 0,
        "name_mismatch": 0,  # 행안부 sep vs VWorld full_nm 불일치
    }
    processed = 0
    status = "completed"

    try:
        for i, row in enumerate(targets, 1):
            if _shutdown:
                logger.warning(f"[중단] {i-1}/{len(targets)} 까지 처리")
                break
            processed = i
            bjd_code = row["bjd_code"]
            layer, field, value, level = layer_of(bjd_code)

            result, err = vworld_centroid(layer, field, value, level)

            if result:
                lat, lng, vw_name = result
                # 행안부 sep 조합 vs VWorld full_nm 비교
                sep_parts = [row.get(f"sep_{k}") for k in range(1, 6)]
                sep_name = " ".join(s for s in sep_parts if s)
                if vw_name and sep_name and vw_name != sep_name:
                    stats["name_mismatch"] += 1
                    _name_diff_append({
                        "bjd_code": bjd_code,
                        "level": level,
                        "layer": layer,
                        "sep_name": sep_name,
                        "vw_name": vw_name,
                    })

                ok = update_row(bjd_code, lat, lng)
                if ok:
                    stats[f"L{level}_ok"] += 1
                    logger.info(
                        f"[{i}/{len(targets)}] L{level} {bjd_code} "
                        f"({lat:.4f},{lng:.4f}) {sep_name}"
                    )
                else:
                    stats["update_failed"] += 1
                    _err_append({
                        "bjd_code": bjd_code,
                        "level": level,
                        "reason": "UPDATE 실패",
                        "lat": lat, "lng": lng,
                    })
            else:
                stats[f"L{level}_fail"] += 1
                _err_append({
                    "bjd_code": bjd_code,
                    "level": level,
                    "layer": layer,
                    "attrFilter": f"{field}:=:{value}",
                    "reason": err,
                })
                logger.warning(
                    f"[{i}/{len(targets)}] FAIL L{level} {bjd_code} "
                    f"{field}={value} ({err})"
                )

            time.sleep(VWORLD_DELAY * random.uniform(0.8, 1.2))

        if _shutdown:
            status = "signal_int" if _shutdown_reason == "SIGINT" else "signal_term"

    except Exception as e:
        status = "error"
        logger.error(f"[예외로 중단] {e}")
        raise
    finally:
        elapsed = time.time() - started
        write_summary(stats, len(targets), processed, started_iso, elapsed, status)
        _close_all()

        ok_total = sum(stats[f"L{i}_ok"] for i in range(1, 5))
        fail_total = sum(stats[f"L{i}_fail"] for i in range(1, 5))
        logger.info("\n" + "=" * 60)
        logger.info(f"완료 ({status})")
        logger.info(
            f"대상 {len(targets)} / 처리 {processed} / "
            f"성공 {ok_total} / 실패 {fail_total} / UPDATE 실패 {stats['update_failed']} / "
            f"소요 {elapsed/60:.1f}분"
        )
        logger.info(
            f"레벨별 성공: L1={stats['L1_ok']} L2={stats['L2_ok']} "
            f"L3={stats['L3_ok']} L4={stats['L4_ok']}"
        )
        logger.info(
            f"레벨별 실패: L1={stats['L1_fail']} L2={stats['L2_fail']} "
            f"L3={stats['L3_fail']} L4={stats['L4_fail']}"
        )
        logger.info(f"요약: {SUM_PATH}")


if __name__ == "__main__":
    main()
