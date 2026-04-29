"""
캠코 온비드 목록 API 필터 작동 검증.

목적:
  - 명세상 옵션 필터 (lctnSdnm, lctnSggnm, cltrUsgLclsCtgrId 등) 가
    실제로 결과를 좁혀주는지 확인.
  - 응답에 ltnoPnu 19자리가 채워지는지 (메모리에는 검증됐다고 적혀있으나 재검증).

배경:
  Phase 3 태양광 API (reference_solar_permit_api.md) 처럼
  명세에는 있는데 실제 무시되는 필터가 한국 공공 API 에 흔함.
  → 본격 개발 전 5분짜리 검증 필수.

판정:
  - 베이스라인 totalCount > 시도 필터 totalCount > 시군구 필터 totalCount
    → 필터 작동 [OK]
  - 셋 다 같으면 → 필터 무시됨 (명세서 사기) [FAIL]
  - lctnSdnm 응답 값이 입력값과 일치 → 필터 정상 작동 추가 증거
"""
import requests
import sys
from typing import Optional

ENDPOINT = "https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2"
SERVICE_KEY = (
    "CWsYAfYYh5I6XFXULGd0/aP6i25mvT6QyAhNyEBPd0GYr6JYMemZBGORK0MwJ1Nx"
    "9IUIFd/zR2WpBenPqk+3zg=="
)


def call(label: str, **extra) -> Optional[dict]:
    """기본 필수 파라미터 + 추가 필터로 호출."""
    params = {
        "serviceKey": SERVICE_KEY,
        "pageNo": 1,
        "numOfRows": 10,
        "resultType": "json",
        "prptDivCd": "0007",  # 압류재산 (가장 흔함)
        "pvctTrgtYn": "N",
        **extra,
    }
    print(f"\n[{label}]")
    print(f"  params: {extra if extra else '베이스라인 (필터 없음)'}")
    try:
        r = requests.get(ENDPOINT, params=params, timeout=15)
    except Exception as e:
        print(f"  [ERR] 호출 실패: {e}")
        return None
    if r.status_code != 200:
        print(f"  [ERR] HTTP {r.status_code}")
        return None
    text = r.text
    if not text.lstrip().startswith("{"):
        print(f"  [ERR] JSON 아님: {text[:200]}")
        return None
    return r.json()


def summarize(label: str, resp: Optional[dict], expect_sd: str = "", expect_sgg: str = ""):
    if not resp:
        return None
    body = resp.get("body", {})
    header = resp.get("header", {})
    code = header.get("resultCode")
    total = body.get("totalCount")
    if code != "00":
        print(f"  resultCode={code} resultMsg={header.get('resultMsg')}")
        return None
    items = body.get("items") or []
    if isinstance(items, dict):
        items = items.get("item", [])
    if not isinstance(items, list):
        items = [items]
    pnu_filled = sum(1 for it in items if str(it.get("ltnoPnu") or "").strip())
    print(f"  totalCount = {total:,}건  /  items={len(items)}건  /  ltnoPnu 채움={pnu_filled}/{len(items)}")
    # 샘플 1건 (필터 일치 확인용)
    if items:
        it = items[0]
        sd = it.get("lctnSdnm", "")
        sgg = it.get("lctnSggnm", "")
        emd = it.get("lctnEmdNm", "")
        nm = it.get("onbidCltrNm", "")
        ltno = it.get("ltnoPnu", "")
        usage = it.get("cltrUsgSclsCtgrNm", "")
        flag_sd = " [OK]" if expect_sd and expect_sd in sd else (" [FAIL]" if expect_sd else "")
        flag_sgg = " [OK]" if expect_sgg and expect_sgg in sgg else (" [FAIL]" if expect_sgg else "")
        print(f"  [sample] {sd} {sgg} {emd}  ({usage})")
        print(f"           매물명: {nm[:60]}")
        print(f"           ltnoPnu: {ltno}{flag_sd}{flag_sgg}")
    return total


def main():
    # 1. 베이스라인 — 필터 없이 전국 압류재산
    base = summarize("베이스라인 (필터 없음)", call("base"))

    # 2. 시도 필터 — 전라남도
    sd = summarize(
        "시도 필터 — 전라남도",
        call("sd", lctnSdnm="전라남도"),
        expect_sd="전라남도",
    )

    # 3. 시군구 필터 — 전라남도 나주시
    sgg = summarize(
        "시도+시군구 — 전라남도 나주시",
        call("sgg", lctnSdnm="전라남도", lctnSggnm="나주시"),
        expect_sd="전라남도", expect_sgg="나주시",
    )

    # 4. 용도 대분류 — 부동산만 (10000)
    usg_l = summarize(
        "용도 대분류 — 10000(부동산)",
        call("usg_l", cltrUsgLclsCtgrId="10000"),
    )

    # 5. 면적 필터 — 50평(165㎡) 이상 토지
    area = summarize(
        "토지면적 165㎡ 이상",
        call("area", landSqmsStart="165"),
    )

    # 6. 다른 시도 — 경상북도 (전라남도 결과랑 다른지)
    sd2 = summarize(
        "시도 필터 — 경상북도",
        call("sd2", lctnSdnm="경상북도"),
        expect_sd="경상북도",
    )

    print("\n" + "=" * 50)
    print("판정")
    print("=" * 50)
    if base is None:
        print("❌ 베이스라인 호출 실패 — 인증/네트워크 문제. 검증 불가.")
        sys.exit(1)
    print(f"  베이스라인:               {base:,}건")
    print(f"  + 전라남도 (시도):        {sd:,}건  → {'줄어듦 [OK]' if sd is not None and sd < base else '동일/증가 [FAIL]'}")
    print(f"  + 전라남도 나주시 (시군구): {sgg:,}건  → {'더 줄어듦 [OK]' if sgg is not None and sd is not None and sgg < sd else '동일/증가 [FAIL]'}")
    print(f"  + 용도 10000(부동산):     {usg_l:,}건  → {'줄어듦 [OK]' if usg_l is not None and usg_l < base else '동일/증가 [FAIL]'}")
    print(f"  + 토지면적 165㎡↑:        {area:,}건  → {'줄어듦 [OK]' if area is not None and area < base else '동일/증가 [FAIL]'}")
    print(f"  + 경상북도 (다른 시도):    {sd2:,}건  → {'전라남도와 다름 [OK]' if sd2 != sd else '동일 [FAIL]'}")


if __name__ == "__main__":
    main()
