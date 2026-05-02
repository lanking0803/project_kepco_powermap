"""
Hyphen 백엔드 검증 v3 — 통합 흐름 가능성 확정 검증.

검증 항목:
  7. bjd_master 에 리(里) 단위 코드 (4157034033) 있는지 — DB 직접 (외부 호출 0)
  8. 소재지조회 응답이 진행중 매물만 주는지, 종결(취하/매각)도 포함하는지
  9. page 빈값/생략 시 default 동작
  10. 매물 0건 케이스 — 외진 리 (응답 형태 확인)
  11. 진행물건검색 vs 소재지조회 매물 일치성 — 같은 동에서 두 API 응답 매물 IDs 비교
"""
import io
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# ── Hyphen (자격증명: docs/SECRETS.local.md Hyphen 섹션. Public repo 노출 OK 합의 — 기본료 충전식)
HKEY = "7a768f0b0b2b8fea"
USER_ID = "anhong7749"
BASE = "https://api.hyphen.im"
HEADERS = {
    "Content-Type": "application/json",
    "Hkey": HKEY,
    "Hyphen-Gustation": "Y",
    "User-Id": USER_ID,
}

# ── Supabase (⚠️ service_role 키는 절대 하드코딩 금지 — 환경변수에서만 로드)
SUPABASE_URL = "https://wtbwgjejfrrwgbzgcdjd.supabase.co"
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
if not SUPABASE_SERVICE_KEY:
    print("[ERR] SUPABASE_SERVICE_ROLE_KEY 환경변수 필요")
    print("      예: export SUPABASE_SERVICE_ROLE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY web/.env.local | cut -d= -f2)")
    sys.exit(1)

OUT_DIR = Path(__file__).parent.parent / "docs" / "api_specs" / "하이픈_부동산법원경매정보"

_LAST_CALL_TS = 0.0


def call_hyphen(path: str, body: Dict[str, Any] | None = None, label: str = "") -> Dict[str, Any]:
    global _LAST_CALL_TS
    elapsed = time.time() - _LAST_CALL_TS
    if elapsed < 21.0 and _LAST_CALL_TS > 0:
        wait = 21.0 - elapsed
        print(f"   [sleep {wait:.1f}s 레이트리밋]")
        time.sleep(wait)
    url = f"{BASE}{path}"
    payload = body if body is not None else {}
    print(f"\n[REQ] POST {url}  {label}")
    if payload:
        print(f"      body={json.dumps(payload, ensure_ascii=False)}")
    r = requests.post(url, headers=HEADERS, json=payload, timeout=30)
    _LAST_CALL_TS = time.time()
    print(f"[RES] HTTP {r.status_code} ({len(r.content)} bytes, {r.elapsed.total_seconds()*1000:.0f}ms)")
    try:
        data = r.json()
    except Exception:
        print(f"[ERR] JSON 파싱 실패: {r.text[:300]}")
        return {}
    common = data.get("common", {})
    print(f"      errYn={common.get('errYn')} msg={common.get('errMsg')}")
    return data


def query_supabase(table: str, params: Dict[str, str]) -> List[Dict[str, Any]]:
    """Supabase REST API 직접 호출 (PostgREST)."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    r = requests.get(url, headers=headers, params=params, timeout=15)
    print(f"      [DB] {url}  params={params} → HTTP {r.status_code}")
    if r.status_code != 200:
        print(f"      [DB ERR] {r.text[:200]}")
        return []
    return r.json()


def save(name: str, payload: Any) -> None:
    out = OUT_DIR / f"_test_v3_{name}.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"      → {out.name}")


def section(title: str) -> None:
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Hyphen 백엔드 검증 v3 — 통합 흐름 확정용")

    # ────────────────────────────────────────────────
    # 검증 7: bjd_master 에 리(里) 단위 코드 있는지
    # ────────────────────────────────────────────────
    section("[검증 7] bjd_master 리 단위 코드 존재 여부 (DB 직접)")
    # Hyphen 소재지코드 앞 10자리 = 4157034033 (대명리)
    # 우리 bjd_master 에 4157034033 이 들어있는지?
    rows = query_supabase("bjd_master", {
        "bjd_code": "eq.4157034033",
        "select": "bjd_code,sep_1,sep_2,sep_3,sep_4,sep_5,lat,lng",
    })
    print(f"      bjd_code=4157034033 결과: {len(rows)}건")
    if rows:
        print(f"      ✅ 리 단위 데이터 존재. 예: {rows[0]}")
    else:
        print(f"      ❌ 리 단위 데이터 없음. 4157034000 (면) 만 있을 가능성")
        # 면 단위 데이터로 확인
        rows_dong = query_supabase("bjd_master", {
            "bjd_code": "eq.4157034000",
            "select": "bjd_code,sep_1,sep_2,sep_3,sep_4,sep_5,lat,lng",
        })
        if rows_dong:
            print(f"      참고: 4157034000 (면) → {rows_dong[0]}")

    # 7-B. 대명리 = 4157034033 도 같이 검색 (sep_5='대명리' 로 역검색)
    rows_li = query_supabase("bjd_master", {
        "sep_5": "eq.대명리",
        "sep_4": "eq.대곶면",
        "select": "bjd_code,sep_1,sep_2,sep_3,sep_4,sep_5,lat,lng",
        "limit": "5",
    })
    print(f"      sep_4=대곶면 AND sep_5=대명리 결과: {len(rows_li)}건")
    for r in rows_li:
        print(f"        {r}")

    # ────────────────────────────────────────────────
    # 검증 8: 소재지조회 응답에 종결 매물도 포함되는지
    # ────────────────────────────────────────────────
    section("[검증 8] 소재지조회 응답의 매물 진행상태 확인")
    # v2 검증6 에서 진행물건검색은 진행상태=취하 도 응답에 포함됐음 → 의외
    # 소재지조회는 어떤지 확인. 1건 매물 받아서 그 product_id 로 상세 호출 → 진행상태 확인
    print("      v2-1B 응답: 대명리 347 → 사건번호코드=8010, 사건번호코드=89327")
    print("      각 사건번호코드 → 상세 호출해서 진행상태 확인")

    # 사건번호코드 8010 의 product_id 를 찾는 게 쉽지 않음.
    # 대신 v2-1B 의 첫 매물(347, 사건번호코드 8010) 을 진행물건검색 응답에서 찾을 수 있는지 비교.
    # 단순화: v2-6 (page=2 김포시) 응답 매물의 진행상태 분포만 출력.
    p2_path = OUT_DIR / "_test_v2_6_page2.json"
    if p2_path.exists():
        p2 = json.loads(p2_path.read_text(encoding="utf-8"))
        items = p2.get("data", {}).get("data", [])
        from collections import Counter
        states = Counter(it.get("진행상태") for it in items)
        print(f"      page=2 김포시 매물 {len(items)}건 진행상태 분포: {dict(states)}")

    # 진행물건검색 vs 소재지조회 비교: 진행물건검색 결과의 첫 매물 소재지 → 소재지조회로 재호출
    # 그러나 진행물건검색의 첫 매물은 "월곶면 고막리 144-11" (취하). 이걸 소재지조회로 검색.
    res_g = call_hyphen("/au0147001245", {"sojaesch": "경기도 김포시 월곶면 고막리 144-11"}, "8 고막리 144-11")
    save("8_gomakri", res_g)
    g_items = res_g.get("data", {}).get("data", [])
    print(f"      → 응답: {len(g_items)}건")
    for it in g_items[:5]:
        print(f"        사건번호코드={it.get('사건번호코드')} {it.get('소재지', '')[:60]}")
    # 만약 사건번호코드 1479871 이 응답에 있으면 → 소재지조회는 종결 매물도 포함
    found = any(it.get("사건번호코드") == 1479871 for it in g_items)
    print(f"      취하 매물(사건번호코드 1479871) 포함 여부: {'✅ 포함됨' if found else '❌ 안 포함'}")

    # ────────────────────────────────────────────────
    # 검증 9: page 빈값/생략 default 동작
    # ────────────────────────────────────────────────
    section("[검증 9] 진행물건검색 — page 생략")
    res_p0 = call_hyphen("/au0147001252", {
        "sido": "41",
        "gugun": "41570",
    }, "9 page 생략")
    save("9_page_omit", res_p0)
    p0 = res_p0.get("data", {})
    print(f"      page 생략 → nowpage={p0.get('nowpage')} totallist={p0.get('totallist')}")

    # ────────────────────────────────────────────────
    # 검증 10: 매물 0건 케이스 — 외진 시골 리
    # ────────────────────────────────────────────────
    section("[검증 10] 매물 0건 케이스")
    # 외진 동: 강원도 인제군 북면 (인적 드문 곳, 행안부 리 코드 4281033025 정도)
    res_zero = call_hyphen("/au0147001245", {"sojaesch": "강원도 인제군 북면 한계리 999-999"}, "10 가짜 지번")
    save("10_zero", res_zero)
    z = res_zero.get("data", {}).get("data")
    print(f"      가짜 지번 응답: data 타입={type(z).__name__}, 값={z}")

    # ────────────────────────────────────────────────
    # 검증 11: 소재지조회 vs 진행물건검색 매물 일치성
    # ────────────────────────────────────────────────
    section("[검증 11] 데이터 소스 일치성")
    # 검증 8 의 응답 사건번호코드 set
    g_sno_set = set(it.get("사건번호코드") for it in g_items)
    print(f"      소재지조회 (고막리 144-11) 사건번호코드: {g_sno_set}")
    # v2-6 page=2 응답에서 고막리 매물 추출
    if p2_path.exists():
        p2 = json.loads(p2_path.read_text(encoding="utf-8"))
        p2_items = p2.get("data", {}).get("data", [])
        gomak_in_search = [it for it in p2_items if "고막리" in it.get("대표소재지", "")]
        print(f"      진행물건검색 page=2 의 고막리 매물: {len(gomak_in_search)}건")
        for it in gomak_in_search:
            print(f"        사건번호코드={it.get('사건번호코드')} 진행={it.get('진행상태')} {it.get('대표소재지', '')[:50]}")
    # v2-1A page=1 의 첫 매물 1004029 / 사건번호코드 1479871 에 대한 직접 검증
    print()
    print(f"      검증6(page=1) 첫 매물: 사건번호코드=1479871 (월곶면 고막리 144-11, 취하)")
    print(f"      소재지조회로 정확히 같은 사건 잡히는지 → 위 응답 출력 참조")

    print("\n" + "=" * 70)
    print("검증 v3 완료. 결과 JSON: docs/api_specs/하이픈_부동산법원경매정보/_test_v3_*.json")
    print("=" * 70)


if __name__ == "__main__":
    main()
