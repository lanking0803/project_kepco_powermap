"""
PNU 직접 구성 검증 — (bjd_code, addr_jibun) 만으로 PNU 만들 수 있는지 실측.

가설:
  PNU(19) = bjd_code(10) + 산구분(1) + 본번(4 zero-padded) + 부번(4 zero-padded)

검증:
  1. DB 의 (bjd_code, addr_jibun) 무작위 100건 추출
  2. 우리가 PNU 구성
  3. VWorld WFS 에 그 PNU 입력 → 응답 받기
  4. 응답 PNU/주소가 우리 데이터와 일치하는지 확인

실행:
  python test_pnu_construction.py            # 기본 100건
  python test_pnu_construction.py --limit 50 # 50건만
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import requests


# ──────────────────────────────────────────
# 설정
# ──────────────────────────────────────────

VWORLD_WFS_URL = "https://api.vworld.kr/req/wfs"
LAYER = "lp_pa_cbnd_bubun"
TIMEOUT_SEC = 10
SLEEP_SEC = 0.1   # VWorld rate limit 보호


# ──────────────────────────────────────────
# PNU 구성 — 검증 대상 핵심 함수 (모듈로 분리됨)
# ──────────────────────────────────────────
# 알고리즘 정의는 crawler/pnu_builder.py 한 곳. 본 검증 도구 + 솔라 워커 +
# 향후 KEPCO 워커가 모두 동일 함수를 import 해서 사용 (유지보수 단일 포인트).

from pnu_builder import to_pnu  # noqa: F401


# ──────────────────────────────────────────
# DB 샘플 추출 (Supabase)
# ──────────────────────────────────────────

def fetch_samples(supabase_url: str, supabase_key: str, limit: int) -> list[dict]:
    """
    kepco_capa 에서 패턴별 골고루 (bjd_code, addr_jibun) 추출.

    3가지 패턴을 균등 분배:
      산_지번:    addr_jibun LIKE '산*'
      부번없음:   addr_jibun NOT LIKE '*-*' (산 제외)
      일반:       addr_jibun LIKE '*-*' (산 제외)

    각 패턴 내부에서 다양한 bjd_code 가 섞이도록 ID 순서 의존성 회피
    (id desc + 큰 풀에서 선택).
    """
    import random
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
    }
    base = f"{supabase_url.rstrip('/')}/rest/v1/kepco_capa"

    cases = {
        "산_지번":   "&addr_jibun=like.%EC%82%B0*",                              # 산*
        "부번없음":  "&addr_jibun=not.like.*-*&addr_jibun=not.like.%EC%82%B0*",  # NOT *-* AND NOT 산*
        "일반":      "&addr_jibun=like.*-*&addr_jibun=not.like.%EC%82%B0*",      # *-* AND NOT 산*
    }

    per_case = max(1, limit // len(cases))
    pool_factor = 30  # 큰 풀에서 랜덤 선택해 bjd_code 다양성 확보

    unique = []
    seen = set()
    for case_name, filt in cases.items():
        url = (
            f"{base}?select=bjd_code,addr_jibun"
            f"&bjd_code=neq.0000000000"
            f"&addr_jibun=not.is.null"
            + filt
            + f"&order=id.desc&limit={per_case * pool_factor}"
        )
        r = requests.get(url, headers=headers, timeout=30)
        r.raise_for_status()
        rows = r.json()
        random.shuffle(rows)
        added = 0
        for row in rows:
            key = (row["bjd_code"], row["addr_jibun"])
            if key in seen:
                continue
            seen.add(key)
            row["_case"] = case_name
            unique.append(row)
            added += 1
            if added >= per_case:
                break
        print(f"      └ {case_name}: {added}건 (풀 {len(rows)})")

    # bjd_master 의 sep_1~5 도 같이 가져옴 (검증 비교용)
    bjds = list({row["bjd_code"] for row in unique})
    bjd_addr_map = {}
    for i in range(0, len(bjds), 100):
        batch = bjds[i:i + 100]
        in_clause = ",".join(f'"{b}"' for b in batch)
        url2 = (
            f"{supabase_url.rstrip('/')}/rest/v1/bjd_master"
            f"?select=bjd_code,sep_1,sep_2,sep_3,sep_4,sep_5"
            f"&bjd_code=in.({in_clause})"
        )
        r2 = requests.get(url2, headers=headers, timeout=30)
        r2.raise_for_status()
        for b in r2.json():
            bjd_addr_map[b["bjd_code"]] = b

    # 합치기
    samples = []
    for row in unique:
        master = bjd_addr_map.get(row["bjd_code"], {})
        samples.append({
            "bjd_code": row["bjd_code"],
            "addr_jibun": row["addr_jibun"],
            "_case": row.get("_case"),
            "sep_1": master.get("sep_1"),
            "sep_2": master.get("sep_2"),
            "sep_3": master.get("sep_3"),
            "sep_4": master.get("sep_4"),
            "sep_5": master.get("sep_5"),
        })
    return samples


# ──────────────────────────────────────────
# VWorld WFS — PNU 직접 조회
# ──────────────────────────────────────────

def query_vworld_by_pnu(api_key: str, pnu: str) -> dict | None:
    """
    PNU 19자리로 WFS 호출. 응답 properties (pnu, ctp_nm, ..., addr) 반환.
    필지 없으면 None.
    """
    fes_filter = (
        '<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0">'
        '<fes:PropertyIsEqualTo>'
        '<fes:ValueReference>pnu</fes:ValueReference>'
        f'<fes:Literal>{pnu}</fes:Literal>'
        '</fes:PropertyIsEqualTo>'
        '</fes:Filter>'
    )
    params = {
        "key": api_key,
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typename": LAYER,
        "output": "application/json",
        "srsName": "EPSG:4326",
        "FILTER": fes_filter,
    }
    headers = {"Referer": "https://sublab.kr"}
    r = requests.get(VWORLD_WFS_URL, params=params, headers=headers, timeout=TIMEOUT_SEC)
    if r.status_code != 200:
        return {"_http_status": r.status_code, "_body": r.text[:300]}
    data = r.json()
    features = data.get("features") or []
    if not features:
        return None
    return features[0].get("properties") or {}


# ──────────────────────────────────────────
# 검증 + 분류
# ──────────────────────────────────────────

def classify(sample: dict, our_pnu: str, vworld_props: dict | None) -> dict:
    """
    결과 분류:
      OK_BOTH      : PNU + 주소 모두 일치
      PNU_ONLY     : PNU 일치하지만 주소 불일치 (행정구역 변경 흔적)
      PNU_MISMATCH : PNU 자체 불일치 (구성 공식 오류)
      NO_FEATURE   : VWorld 응답 없음 (필지 부재)
      HTTP_ERROR   : VWorld API 에러
      PARSE_ERROR  : PNU 구성 자체 실패
    """
    if our_pnu is None:
        return {"category": "PARSE_ERROR"}

    if vworld_props is None:
        return {"category": "NO_FEATURE"}

    if "_http_status" in vworld_props:
        return {
            "category": "HTTP_ERROR",
            "http_status": vworld_props["_http_status"],
            "body": vworld_props.get("_body"),
        }

    vw_pnu = vworld_props.get("pnu", "")
    if vw_pnu != our_pnu:
        return {
            "category": "PNU_MISMATCH",
            "vw_pnu": vw_pnu,
        }

    # PNU 일치 — 주소 비교
    our_addr_parts = [
        sample.get("sep_1"), sample.get("sep_2"), sample.get("sep_3"),
        sample.get("sep_4"), sample.get("sep_5"), sample.get("addr_jibun"),
    ]
    our_addr = " ".join(p for p in our_addr_parts if p)

    vw_addr = vworld_props.get("addr", "")
    # 부분 매칭 — VWorld addr 형식이 다를 수 있어 sep_4 + sep_5 + jibun 만 비교
    key_parts = [
        sample.get("sep_4"), sample.get("sep_5"), sample.get("addr_jibun"),
    ]
    key_str = " ".join(p for p in key_parts if p)

    # 공백 정규화 — KEPCO "산235-2" vs VWorld "산 235-2" 같은 띄어쓰기 차이 흡수
    key_norm = "".join(key_str.split())
    vw_norm = "".join(vw_addr.split())
    if key_norm and key_norm in vw_norm:
        return {
            "category": "OK_BOTH",
            "our_addr": our_addr,
            "vw_addr": vw_addr,
        }
    return {
        "category": "PNU_ONLY",
        "our_addr": our_addr,
        "vw_addr": vw_addr,
    }


# ──────────────────────────────────────────
# 메인
# ──────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=100, help="샘플 수")
    args = parser.parse_args()

    # 환경변수
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_KEY")
    vworld_key = os.environ.get("VWORLD_KEY")
    if not (supabase_url and supabase_key and vworld_key):
        print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY / VWORLD_KEY 환경변수 필요", file=sys.stderr)
        sys.exit(1)

    print(f"[1/3] DB 에서 {args.limit}개 샘플 추출 중...")
    samples = fetch_samples(supabase_url, supabase_key, args.limit)
    print(f"      → {len(samples)}개 확보")

    print(f"[2/3] PNU 구성 + VWorld 조회 (각 {SLEEP_SEC}s 간격)...")
    results = []
    cats = ["OK_BOTH", "PNU_ONLY", "PNU_MISMATCH", "NO_FEATURE", "HTTP_ERROR", "PARSE_ERROR"]
    counters = {c: 0 for c in cats}
    case_counters: dict[str, dict[str, int]] = {}  # case_name → {category → count}

    for i, sample in enumerate(samples, 1):
        # PNU 구성
        try:
            our_pnu = to_pnu(sample["bjd_code"], sample["addr_jibun"])
            parse_err = None
        except Exception as e:
            our_pnu = None
            parse_err = str(e)

        # VWorld 호출
        vw_props = None
        if our_pnu:
            try:
                vw_props = query_vworld_by_pnu(vworld_key, our_pnu)
            except Exception as e:
                vw_props = {"_http_status": -1, "_body": str(e)[:200]}

        cls = classify(sample, our_pnu, vw_props)
        if parse_err:
            cls["parse_error"] = parse_err
        cls["sample"] = sample
        cls["our_pnu"] = our_pnu
        cls["vw_props"] = vw_props
        results.append(cls)
        counters[cls["category"]] += 1
        case_name = sample.get("_case", "기타")
        case_counters.setdefault(case_name, {c: 0 for c in cats})[cls["category"]] += 1

        if i % 10 == 0 or i == len(samples):
            pct = ", ".join(f"{k}={v}" for k, v in counters.items() if v > 0)
            print(f"      [{i:3d}/{len(samples)}] {pct}")
        time.sleep(SLEEP_SEC)

    print(f"\n[3/3] 결과 집계 (전체)")
    total = len(results)
    for cat, cnt in counters.items():
        if cnt > 0:
            print(f"  {cat:13s}: {cnt:4d} ({100.0 * cnt / total:.1f}%)")

    print(f"\n[3/3] 결과 집계 (케이스별)")
    for case_name, c_counters in case_counters.items():
        ok = c_counters["OK_BOTH"]
        case_total = sum(c_counters.values())
        fails = ", ".join(f"{k}={v}" for k, v in c_counters.items() if v > 0 and k != "OK_BOTH")
        pct = 100.0 * ok / case_total if case_total else 0
        suffix = f" / {fails}" if fails else ""
        print(f"  {case_name:8s}: {ok}/{case_total} ({pct:.1f}%){suffix}")

    # 실패 케이스 jsonl 저장 (분석용)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    fail_path = Path(f"test_pnu_failures_{ts}.jsonl")
    with fail_path.open("w", encoding="utf-8") as f:
        for r in results:
            if r["category"] != "OK_BOTH":
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"\n실패 케이스: {fail_path}")

    # 결정 가이드
    ok_pct = 100.0 * counters["OK_BOTH"] / total
    print(f"\n=== 결정 가이드 ===")
    print(f"  OK_BOTH 비율: {ok_pct:.1f}%")
    if ok_pct >= 95:
        print(f"  ✅ 채택 — PNU 직접 구성 신뢰 가능")
    elif ok_pct >= 80:
        print(f"  ⚠️ 부분 채택 — 실패 시 폴백(지오코딩) 필요")
    else:
        print(f"  ❌ 미채택 — 공식 수정 또는 기존 흐름 유지")


if __name__ == "__main__":
    main()
