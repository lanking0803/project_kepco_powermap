"""
Hyphen 경매 API 백엔드 검증 v2 — 통합 흐름 가능성 검증.

목표:
  실제 PNU 클릭 → 경매 매물 매칭 흐름이 정말 작동하는지 다각도로 검증.
  애매한 부분은 모두 직접 호출로 확인.

검증 항목:
  1. 소재지조회 정밀도 — "리" vs "리 + 지번" 입력 응답 수 비교
  2. 소재지코드 19자리 ↔ 우리 PNU 매칭 — 같은 지번 다른 코드 가능성
  3. 우리 KEPCO DB 의 실제 PNU 로 역추적 — 매칭 가능 비율
  4. 경매사건상세보기 — product_id 로 실제 풍부한 응답 받기
  5. 용도코드 필터 — 토지/창고/농가시설 각각 응답 (의뢰자 5종 카테고리 확정)
  6. 페이지네이션 — 총 686건이 page=2,3...로 잘 넘어가는지

⚠️ 레이트리밋 = 20초/호출. 11회 호출 ≈ 4분.
"""
import io
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

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

_LAST_CALL_TS = 0.0


def call(path: str, body: Dict[str, Any] | None = None, label: str = "") -> Dict[str, Any]:
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
    err_yn = common.get("errYn")
    err_msg = common.get("errMsg")
    print(f"      errYn={err_yn} msg={err_msg}")
    return data


def save(name: str, payload: Any) -> None:
    out = OUT_DIR / f"_test_v2_{name}.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"      → {out.name}")


def section(title: str) -> None:
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Hyphen 경매 API 백엔드 검증 v2")
    print(f"테스트 대상: 경기도 김포시 대곶면 대명리")

    # ───────────────────────────────────────────
    # 검증 1: 소재지조회 정밀도 — "리" vs "리 + 지번"
    # ───────────────────────────────────────────
    section("[검증 1] 소재지조회 정밀도")

    # 1-A. 리 단위
    res_li = call("/au0147001245", {"sojaesch": "경기도 김포시 대곶면 대명리"}, "1-A 리단위")
    items_li = res_li.get("data", {}).get("data", [])
    print(f"      → 리 단위 응답: {len(items_li)}건")
    save("1A_li", res_li)

    # 1-B. 리 + 지번
    res_jb = call("/au0147001245", {"sojaesch": "경기도 김포시 대곶면 대명리 347"}, "1-B 리+지번")
    items_jb = res_jb.get("data", {}).get("data", [])
    print(f"      → 리+지번 응답: {len(items_jb)}건")
    if items_jb:
        for x in items_jb[:5]:
            print(f"        {x.get('소재지코드')}  {x.get('소재지')[:60]}")
    save("1B_li_jibun", res_jb)

    # 1-C. 더 정밀한 지번 (실제 매물 있는 곳 — 대명리 60-9 = 사건번호 118229 검증된 매물)
    res_pp = call("/au0147001245", {"sojaesch": "경기도 김포시 대곶면 대명리 60-9"}, "1-C 정밀지번")
    items_pp = res_pp.get("data", {}).get("data", [])
    print(f"      → 정밀 지번 응답: {len(items_pp)}건")
    if items_pp:
        for x in items_pp[:5]:
            print(f"        {x.get('소재지코드')}  {x.get('소재지')[:60]}")
    save("1C_precise", res_pp)

    # 결론: 정밀도가 동일하면 클라이언트 후처리 필요. 좁아지면 호출 효율↑

    # ───────────────────────────────────────────
    # 검증 2: 소재지코드 19자리 vs 우리 PNU 비교
    # ───────────────────────────────────────────
    section("[검증 2] 소재지코드 ↔ PNU 매칭 가능성")
    # 1-A 응답 데이터에서 소재지코드 패턴 분석 (호출 X)

    if items_li:
        codes = [it.get("소재지코드") for it in items_li if it.get("소재지코드")]
        print(f"      대명리 소재지코드 예시 5건:")
        for c in codes[:5]:
            print(f"        {c}  (앞 10자리: {c[:10]}, 11번째: {c[10]}, 본번: {c[11:15]}, 부번: {c[15:19]})")
        # 행안부 표준 vs Hyphen 의 차이
        # 행안부: bjd_code 끝 4자리 = 동/리 단위 (예: 4000=대곶면 대명리는 전체)
        # Hyphen: 끝 4자리 다른 값 가능성
        prefixes = set(c[:10] for c in codes)
        print(f"      앞 10자리 종류: {len(prefixes)}개 — {prefixes}")
        # 산구분 자리 (11번째)
        san_chars = set(c[10] for c in codes)
        print(f"      11번째(산구분) 종류: {san_chars}")
        # 우리 PNU 스타일: 1=일반, 2=산
        # Hyphen 도 동일 패턴인지 확인

    # ───────────────────────────────────────────
    # 검증 3: 우리 KEPCO DB의 실제 대명리 PNU 와 매칭 비율
    # ───────────────────────────────────────────
    section("[검증 3] 우리 PNU 와 매칭 비율 (외부 호출 X)")
    # supabase 조회는 환경변수 필요해서 일단 패스. 클라이언트 매칭 로직은 v3 에서 검증.
    # 대신 응답의 소재지 텍스트 파싱으로 우리 PNU 조립 가능한지 검증.
    if items_li:
        print("      소재지 텍스트 → 본번/부번 추출 가능성 확인")
        import re
        for it in items_li[:10]:
            sojae = it.get("소재지", "")
            # 한글주소에서 "대명리 XXX-XX" 또는 "대명리 산XXX-XX" 추출
            m = re.search(r"대명리\s+(산)?(\d+)(?:-(\d+))?", sojae)
            if m:
                san = "1" if m.group(1) else "0"  # 우리 표준: 1=일반,2=산. 여기선 일반=0,산=1로 표기
                bon = m.group(2).zfill(4)
                bu = (m.group(3) or "0").zfill(4)
                pnu_assembled = f"4157034000{2 if san=='1' else 1}{bon}{bu}"
                code = it.get("소재지코드")
                match = "✅" if code == pnu_assembled else "❌"
                print(f"        {sojae[:50]:50}  → {pnu_assembled} {match} (응답: {code})")
            else:
                print(f"        {sojae[:50]:50}  → 파싱 실패")

    # ───────────────────────────────────────────
    # 검증 4: 경매사건상세보기 (product_id 로 풍부한 데이터)
    # ───────────────────────────────────────────
    section("[검증 4] 경매사건상세보기 (au0147001254)")
    # 1-A 응답에서 사건번호코드 1개 골라 상세 호출 시도
    # ⚠️ 명세서: product_id = 경매번호. 1-A 응답엔 사건번호코드만 있음.
    # 진행물건검색(1252) 응답엔 경매번호 직접 있었음. → 거기서 가져옴.
    print("      _test_06_search_김포.json 의 경매번호 1004029 사용")
    res_detail = call("/au0147001254", {"product_id": "1004029"}, "사건상세")
    save("4_detail", res_detail)
    detail = res_detail.get("data", {}).get("data", {})
    if detail:
        print(f"      매물 키 ({len(detail)}개):")
        for k in list(detail.keys())[:30]:
            v = detail[k]
            v_str = str(v)[:80] if v else "null"
            print(f"        {k}: {v_str}")

    # ───────────────────────────────────────────
    # 검증 5: 용도코드 필터 — 우리 5종 카테고리
    # ───────────────────────────────────────────
    section("[검증 5] 용도코드 필터 — 토지(31)+임야(33)")
    # 토지 카테고리 후보: 31(농지), 33(임야), 34(대지), 36(잡종지), 37(과수원), 38(목장용지), 45(창고용지), 51(농가관련시설)
    # 하나만 일단 — 임야(33) — 검증6 결과(취하 매물도 포함된 것)에 임야가 많을 듯
    res_yongdo = call("/au0147001252", {
        "page": "1",
        "sido": "41",
        "gugun": "41570",
        "yongdo": "33",  # 임야
    }, "용도=임야 김포시")
    save("5_yongdo_33", res_yongdo)
    y_data = res_yongdo.get("data", {})
    print(f"      임야(33) 김포시: {y_data.get('totallist')}건")
    y_items = y_data.get("data", [])
    for it in y_items[:3]:
        print(f"        {it.get('대표소재지', '')[:50]}  용도={it.get('물건용도코드')} 진행={it.get('진행상태')}")

    # ───────────────────────────────────────────
    # 검증 6: 페이지네이션 page=2 동작
    # ───────────────────────────────────────────
    section("[검증 6] 페이지네이션 page=2")
    res_p2 = call("/au0147001252", {
        "page": "2",
        "sido": "41",
        "gugun": "41570",
    }, "page=2 김포시")
    save("6_page2", res_p2)
    p2 = res_p2.get("data", {})
    print(f"      page=2: nowpage={p2.get('nowpage')} totallist={p2.get('totallist')} totalpage={p2.get('totalpage')}")
    p2_items = p2.get("data", [])
    print(f"      매물 {len(p2_items)}건. 첫 매물:")
    if p2_items:
        f = p2_items[0]
        print(f"        경매번호={f.get('경매번호')} 소재지={f.get('대표소재지', '')[:50]}")

    print("\n" + "=" * 70)
    print("검증 완료. 결과 JSON: docs/api_specs/하이픈_부동산법원경매정보/_test_v2_*.json")
    print("=" * 70)


if __name__ == "__main__":
    main()
