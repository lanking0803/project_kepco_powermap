"""
Hyphen 백엔드 검증 v5 — 검색 파라미터 14필드 작동 검증.

목적: AuctionSearchUiParams 모델의 모든 필드가 Hyphen 진행물건검색
(au0147001252) 에서 실제 작동하는지 확인. UI 만들기 전에 헛수고 방지.

검증 항목:
  1. 면적 필터 (larea_min/max, barea_min/max) — 작동 여부 + 단위 (㎡)
  2. 가격 필터 (gamMin/Max, lowMin/Max) — 작동 여부 + 단위 (원)
  3. 매각기일 필터 (sday_s/e) — 작동 여부 + 형식
  4. 용도 필터 (yongdo) — 단일 호출 OK?
  5. 법원 필터 (court) — 코드표 + 작동 여부
  6. 응답 진행상태 분포 — "진행/유찰/매각/취하" 어떤 값들이 실제 오는지
  7. 응답 유찰수(`유찰수`) 분포 — 클라이언트 필터 효용성 평가

기준 지역: 경기도(sido=41) 김포시(gugun=41570) — v2~v4 에서 매물 다수 확인됨.

호출 방식: 테스트 모드 (Hyphen-Gustation: Y), 21초 레이트리밋.
총 호출: 14회 → 약 5분 소요.

결과 저장: docs/api_specs/하이픈_부동산법원경매정보/_test_v5_*.json
"""
import io
import json
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any, Dict

import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

HKEY = "7a768f0b0b2b8fea"
USER_ID = "anhong7749"
BASE = "https://api.hyphen.im"
HEADERS = {
    "Content-Type": "application/json",
    "Hkey": HKEY,
    "Hyphen-Gustation": "Y",
    "User-Id": USER_ID,
}

OUT_DIR = Path(__file__).parent.parent / "docs" / "api_specs" / "하이픈_부동산법원경매정보"
SEARCH_PATH = "/au0147001252"
COURT_LIST_PATH = "/au0147001245"

_LAST_CALL_TS = 0.0


def call(path: str, body: Dict[str, Any] | None = None, label: str = "") -> Dict[str, Any]:
    """레이트리밋 21초 보장 + JSON 파싱 + errCd 출력."""
    global _LAST_CALL_TS
    elapsed = time.time() - _LAST_CALL_TS
    if elapsed < 21.0 and _LAST_CALL_TS > 0:
        wait = 21.0 - elapsed
        print(f"   [sleep {wait:.1f}s 레이트리밋]")
        time.sleep(wait)
    url = f"{BASE}{path}"
    payload = body if body is not None else {}
    print(f"\n[REQ] POST {url}  {label}")
    print(f"      body={json.dumps(payload, ensure_ascii=False)}")
    r = requests.post(url, headers=HEADERS, json=payload, timeout=30)
    _LAST_CALL_TS = time.time()
    print(
        f"[RES] HTTP {r.status_code} ({len(r.content)} bytes, "
        f"{r.elapsed.total_seconds()*1000:.0f}ms)"
    )
    try:
        data = r.json()
    except Exception:
        print(f"[ERR] JSON 파싱 실패: {r.text[:300]}")
        return {}
    common = data.get("common", {})
    print(
        f"      errYn={common.get('errYn')} errCd={common.get('errCd')} "
        f"msg={common.get('errMsg')}"
    )
    return data


def save(name: str, payload: Any) -> None:
    out = OUT_DIR / f"_test_v5_{name}.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"      → {out.name}")


def section(title: str) -> None:
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78)


def summarize(data: Dict[str, Any], label: str = "") -> Dict[str, Any]:
    """응답 요약 — 매물 수, 진행상태/유찰수/면적/가격 분포 포함."""
    body = data.get("data") or {}
    items = body.get("data") or []
    totallist = body.get("totallist", "0")
    totalpage = body.get("totalpage", "1")

    if not items:
        print(f"      [요약] 매물 0건 (totallist={totallist})")
        return {"count": 0, "totallist": totallist, "totalpage": totalpage}

    def _num(v: Any) -> float | None:
        """str/int/float 모두 float 로. None/빈문자열은 None."""
        if v is None or v == "":
            return None
        try:
            return float(v)
        except (ValueError, TypeError):
            return None

    statuses = Counter(it.get("진행상태") for it in items)
    usbds = Counter(it.get("유찰수") for it in items)
    yongdos = Counter(it.get("물건용도코드") for it in items)
    larea_vals = [v for v in (_num(it.get("토지면적")) for it in items) if v is not None]
    barea_vals = [v for v in (_num(it.get("건물면적")) for it in items) if v is not None]
    gam_vals = [v for v in (_num(it.get("감정가")) for it in items) if v is not None]
    low_vals = [v for v in (_num(it.get("최저가")) for it in items) if v is not None]

    print(f"      [요약 {label}] 매물 {len(items)}건 / totallist={totallist} / page={totalpage}")
    print(f"        진행상태 분포: {dict(statuses)}")
    print(f"        유찰수 분포  : {dict(usbds)}")
    print(f"        용도코드 상위5: {dict(yongdos.most_common(5))}")
    if larea_vals:
        print(
            f"        토지면적(㎡): min={min(larea_vals):.0f} "
            f"max={max(larea_vals):.0f} cnt={len(larea_vals)}"
        )
    if barea_vals:
        print(
            f"        건물면적(㎡): min={min(barea_vals):.0f} "
            f"max={max(barea_vals):.0f} cnt={len(barea_vals)}"
        )
    if gam_vals:
        print(
            f"        감정가(원) : min={min(gam_vals):,.0f} "
            f"max={max(gam_vals):,.0f}"
        )
    if low_vals:
        print(
            f"        최저가(원) : min={min(low_vals):,.0f} "
            f"max={max(low_vals):,.0f}"
        )
    return {
        "count": len(items),
        "totallist": totallist,
        "totalpage": totalpage,
        "statuses": dict(statuses),
        "usbds": dict(usbds),
        "yongdos": dict(yongdos),
    }


# ─────────────────────────────────────────────────────────────
#  검증 본체
# ─────────────────────────────────────────────────────────────
def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Hyphen 검색 파라미터 14필드 검증 v5")
    print(f"  기준 지역: 경기도 김포시 (sido=41, gugun=41570)")

    base_params = {"sido": "41", "gugun": "41570", "page": "1"}

    # ────────────────────────────────────────────────
    # [기준선] 김포시 전체 매물 — 베이스라인
    # ────────────────────────────────────────────────
    section("[1/14] 기준선 — 김포시 page=1 (필터 없음)")
    res = call(SEARCH_PATH, base_params, "baseline 김포")
    save("01_baseline_김포", res)
    summary_baseline = summarize(res, "baseline")

    # ────────────────────────────────────────────────
    # 면적 필터 (larea / barea)
    # ────────────────────────────────────────────────
    section("[2/14] larea_min=1000 — 토지면적 1000㎡ 이상")
    res = call(
        SEARCH_PATH,
        {**base_params, "larea_min": "1000"},
        "larea_min=1000",
    )
    save("02_larea_min_1000", res)
    summarize(res, "larea≥1000")

    section("[3/14] larea_min=500 + larea_max=2000 — 토지 500~2000㎡")
    res = call(
        SEARCH_PATH,
        {**base_params, "larea_min": "500", "larea_max": "2000"},
        "larea 500~2000",
    )
    save("03_larea_500_2000", res)
    summarize(res, "larea 500~2000")

    section("[4/14] barea_min=100 — 건물면적 100㎡ 이상 (토지전용 매물 제외 효과 확인)")
    res = call(
        SEARCH_PATH,
        {**base_params, "barea_min": "100"},
        "barea_min=100",
    )
    save("04_barea_min_100", res)
    summarize(res, "barea≥100")

    # ────────────────────────────────────────────────
    # 가격 필터 (gamMin/Max, lowMin/Max)
    # ────────────────────────────────────────────────
    section("[5/14] gamMin=100000000 — 감정가 1억 이상 (단위=원 검증)")
    res = call(
        SEARCH_PATH,
        {**base_params, "gamMin": "100000000"},
        "gamMin=1억",
    )
    save("05_gamMin_1eok", res)
    summarize(res, "gam≥1억")

    section("[6/14] gamMin=100000000 + gamMax=500000000 — 감정가 1억~5억")
    res = call(
        SEARCH_PATH,
        {**base_params, "gamMin": "100000000", "gamMax": "500000000"},
        "gam 1억~5억",
    )
    save("06_gam_1_5_eok", res)
    summarize(res, "gam 1~5억")

    section("[7/14] lowMin=50000000 — 최저가 5천만 이상")
    res = call(
        SEARCH_PATH,
        {**base_params, "lowMin": "50000000"},
        "lowMin=5천만",
    )
    save("07_lowMin_5cheon", res)
    summarize(res, "low≥5천만")

    # ────────────────────────────────────────────────
    # 매각기일 필터 (sday_s/e)
    # ────────────────────────────────────────────────
    section("[8/14] sday_s=2026-05-01 sday_e=2026-12-31 — 매각기일 5월~12월")
    res = call(
        SEARCH_PATH,
        {
            **base_params,
            "sday_s": "2026-05-01",
            "sday_e": "2026-12-31",
        },
        "sday 2026-05~12",
    )
    save("08_sday_2026_5_12", res)
    summarize(res, "sday 2026-05~12")

    section("[9/14] sday_s=2030-01-01 — 매각기일 미래(0건 예상, 형식 작동 검증)")
    res = call(
        SEARCH_PATH,
        {**base_params, "sday_s": "2030-01-01"},
        "sday 2030+",
    )
    save("09_sday_2030_future", res)
    summarize(res, "sday≥2030")

    # ────────────────────────────────────────────────
    # 용도 필터 (yongdo)
    # ────────────────────────────────────────────────
    section("[10/14] yongdo=33 (임야)")
    res = call(SEARCH_PATH, {**base_params, "yongdo": "33"}, "yongdo=33 임야")
    save("10_yongdo_33_임야", res)
    summarize(res, "yongdo=33")

    section("[11/14] yongdo=31 (농지)")
    res = call(SEARCH_PATH, {**base_params, "yongdo": "31"}, "yongdo=31 농지")
    save("11_yongdo_31_농지", res)
    summarize(res, "yongdo=31")

    # ────────────────────────────────────────────────
    # 법원 코드 마스터 + 필터
    # ────────────────────────────────────────────────
    section("[12/14] 법원코드 마스터 (au0147001245)")
    res_courts = call(COURT_LIST_PATH, None, "법원코드 list")
    save("12_courts", res_courts)
    courts_data = (res_courts.get("data") or {}).get("data") or []
    if courts_data:
        # 김포 매물의 법원간략명 = "부천" 으로 추정 → 부천 코드 찾기
        match = [c for c in courts_data if "부천" in (c.get("법원명") or "")]
        print(f"      법원 총 {len(courts_data)}개. '부천' 매칭 {len(match)}개:")
        for c in match[:5]:
            print(f"        {c}")
        first_court_code = match[0].get("법원코드") if match else None
    else:
        first_court_code = None
        print("      ❌ 법원코드 데이터 없음")

    section("[13/14] court=부천코드 — 부천지원 매물만")
    if first_court_code:
        res = call(
            SEARCH_PATH,
            {"sido": "41", "page": "1", "court": first_court_code},
            f"court={first_court_code}",
        )
        save("13_court_부천", res)
        summarize(res, f"court={first_court_code}")
    else:
        print("      [SKIP] 법원코드 미확정")

    # ────────────────────────────────────────────────
    # 복합 필터 — 영업담당자 실전 시나리오
    # ────────────────────────────────────────────────
    section("[14/14] 복합 필터 — 김포 임야 + 토지 1000㎡↑ + 감정가 1~5억")
    res = call(
        SEARCH_PATH,
        {
            **base_params,
            "yongdo": "33",
            "larea_min": "1000",
            "gamMin": "100000000",
            "gamMax": "500000000",
        },
        "복합 필터 (임야+면적+가격)",
    )
    save("14_combo_임야_면적_가격", res)
    summarize(res, "복합")

    # ────────────────────────────────────────────────
    # 결과 종합
    # ────────────────────────────────────────────────
    section("[결과 종합]")
    print(
        "  → 각 검증의 errYn=N + 매물 수 변화 = 필터 작동 증거.\n"
        "  → errCd=407 (매물 0건) 도 정상 응답 — 필터가 너무 좁혀진 경우.\n"
        "  → JSON 파일은 docs/api_specs/하이픈_부동산법원경매정보/_test_v5_*.json"
    )
    print("\n검증 v5 완료\n")


if __name__ == "__main__":
    main()
