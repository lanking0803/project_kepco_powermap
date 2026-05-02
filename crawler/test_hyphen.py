"""
Hyphen 부동산 법원경매 정보(경매다) API 호출 테스트.

목적:
  1. 시도/구군/동 코드가 행안부 표준 bjd_code 와 일치하는지 검증
  2. 용도코드(yongdo) 매핑 테이블 확보 — 우리 5종 카테고리 대응
  3. 소재지조회(sojaesch) 가 한글주소 → scode 변환기인지 확인
  4. 경매진행물건검색 실호출 → 매물 1건 응답 형태 확정 (지번주소/감정가/매각기일 포맷)

명세: docs/api_specs/하이픈_부동산법원경매정보/_extract.txt (PDF 추출, 한글 깨짐)
실제 스키마: 의뢰자가 캡처/JSON 으로 전달 (대화 로그 참조)

인증:
  Endpoint: https://api.hyphen.im/au01470012XX
  Headers: Hkey, User-Id, Hyphen-Gustation: Y, Content-Type: application/json
  자격: docs/SECRETS.local.md Hyphen 섹션
  비즈머니: 110,000원 (의뢰자 부담, 검증 비용 약간 들어가도 OK 합의)

실행:
  cd crawler
  python test_hyphen.py
"""
import io
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict

import requests

# Windows cp949 콘솔에서 한글/특수문자 출력 안전화
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


_LAST_CALL_TS = 0.0


def call(path: str, body: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Hyphen 테스트는 20초/호출 레이트리밋. 자동 sleep."""
    global _LAST_CALL_TS
    elapsed = time.time() - _LAST_CALL_TS
    if elapsed < 21.0 and _LAST_CALL_TS > 0:
        wait = 21.0 - elapsed
        print(f"      [sleep {wait:.1f}s — 20초 레이트리밋]")
        time.sleep(wait)
    url = f"{BASE}{path}"
    payload = body if body is not None else {}
    print(f"\n[REQ] POST {url}")
    if payload:
        print(f"      body={json.dumps(payload, ensure_ascii=False)}")
    r = requests.post(url, headers=HEADERS, json=payload, timeout=15)
    _LAST_CALL_TS = time.time()
    print(f"[RES] HTTP {r.status_code} ({len(r.content)} bytes, {r.elapsed.total_seconds()*1000:.0f}ms)")
    try:
        data = r.json()
    except Exception:
        print(f"[ERR] JSON 파싱 실패: {r.text[:300]}")
        sys.exit(1)
    common = data.get("common", {})
    err_yn = common.get("errYn")
    err_cd = common.get("errCd")
    err_msg = common.get("errMsg")
    print(f"      errYn={err_yn} errCd={err_cd} msg={err_msg}")
    if err_yn == "Y":
        print(f"[ERR] 비즈니스 에러로 중단")
        print(json.dumps(data, ensure_ascii=False, indent=2)[:2000])
        sys.exit(1)
    return data


def save_jsonl(name: str, payload: Dict[str, Any]) -> None:
    """결과를 docs/api_specs/하이픈_부동산법원경매정보/_test_<name>.json 으로 보관."""
    out_dir = Path(__file__).parent.parent / "docs" / "api_specs" / "하이픈_부동산법원경매정보"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"_test_{name}.json"
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"      → 저장 {out_path}")


def main() -> None:
    print("=" * 70)
    print("Hyphen 경매 API 검증")
    print("=" * 70)

    # ── 1) 시도코드조회 — 이미 의뢰자가 검증함. 재호출 검증 + 저장.
    print("\n## 1) 시도코드조회 (au0147001246)")
    sido_res = call("/au0147001246")
    save_jsonl("01_sido", sido_res)
    sido_dict = sido_res.get("data", {}).get("data", {})
    print(f"      시도 {len(sido_dict)}건: {list(sido_dict.items())[:3]}...")

    # ── 2) 구군코드조회 (sido=경기 41) — 행안부 5자리 일치 검증
    print("\n## 2) 구군코드조회 (au0147001247) — 경기도(41) 산하 시군구")
    gugun_res = call("/au0147001247", {"sido": "41"})
    save_jsonl("02_gugun_경기", gugun_res)
    gugun_data = gugun_res.get("data", {}).get("data", [])
    print(f"      구군 {len(gugun_data)}건. 처음 3건:")
    for g in gugun_data[:3]:
        print(f"        {g}")

    # ── 3) 동코드조회 (gugun=김포시 추정 코드) — 응답에서 김포시 코드 추출 후 사용
    # 김포시 행안부 표준코드 = 41570. 그게 맞는지 응답으로 확인.
    print("\n## 3) 동코드조회 (au0147001248) — 김포시 산하 읍면동")
    # 일단 41570 으로 시도. 결과가 비면 행안부 표준이 아닌 거.
    dong_res = call("/au0147001248", {"gugun": "41570"})
    save_jsonl("03_dong_김포41570", dong_res)
    dong_data = dong_res.get("data", {}).get("data", [])
    print(f"      동 {len(dong_data)}건. 처음 5건:")
    for d in dong_data[:5]:
        print(f"        {d}")

    # ── 4) 용도별코드조회 — 우리 5종 카테고리 매핑용
    print("\n## 4) 용도별코드조회 (au0147001250)")
    yongdo_res = call("/au0147001250")
    save_jsonl("04_yongdo", yongdo_res)
    yongdo_data = yongdo_res.get("data", {}).get("data", [])
    print(f"      용도 {len(yongdo_data)}건:")
    for y in yongdo_data:
        print(f"        {y}")

    # ── 5) 소재지조회 — 한글주소 → scode 변환 확인
    print("\n## 5) 소재지조회 (au0147001245) — 한글주소 입력")
    sojae_res = call("/au0147001245", {"sojaesch": "경기도 김포시 대곶면 대명리"})
    save_jsonl("05_sojaesch_대명리", sojae_res)
    print(f"      응답: {json.dumps(sojae_res.get('data'), ensure_ascii=False)}")

    # ── 6) 경매진행물건검색 — 경기도(41) 김포시 sweep 1페이지
    print("\n## 6) 경매진행물건검색 (au0147001252) — 김포시 1페이지")
    search_res = call("/au0147001252", {
        "page": "1",
        "sido": "41",
        "gugun": "41570",  # 김포시 추정
    })
    save_jsonl("06_search_김포", search_res)
    sdata = search_res.get("data", {})
    print(f"      nowpage={sdata.get('nowpage')} totallist={sdata.get('totallist')} totalpage={sdata.get('totalpage')}")
    items = sdata.get("data", [])
    if items:
        sample = items[0]
        print(f"      매물 1건 키({len(sample)}개):")
        for k in list(sample.keys())[:20]:
            v = sample[k]
            v_short = (str(v)[:60] + "...") if v and len(str(v)) > 60 else v
            print(f"        {k}: {v_short}")
    else:
        print(f"      매물 0건")

    print("\n" + "=" * 70)
    print("검증 완료. 결과 JSON: docs/api_specs/하이픈_부동산법원경매정보/_test_*.json")
    print("=" * 70)


if __name__ == "__main__":
    main()
