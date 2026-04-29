"""
캠코 온비드 부동산 물건목록 조회 API 호출 테스트.

목적:
  - 응답에 지번 단위 식별자(ltnoPnu 19자리)가 정상 채워지는지 확인
  - 시도/시군구/읍면동 + 물건명(지번 포함 텍스트) 동시 추출 가능 여부 확인
  - resultCode 00 (정상) 응답 받는지 확인 — 신청 직후 권한 활성 여부 검증 포함

명세: docs/api_specs/온비드_공매/_extract.txt
  Endpoint: https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2
  필수 파라미터: serviceKey, pageNo, numOfRows, resultType, prptDivCd, pvctTrgtYn

실행:
  python test_onbid.py
"""
import json
import sys
from pprint import pprint

import requests


ENDPOINT = "https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2"

# 공공데이터포털 동일 계정 인증키 (건축물대장과 공유)
# decoding 형태 — requests 가 자동으로 URL-encode 함
SERVICE_KEY = (
    "CWsYAfYYh5I6XFXULGd0/aP6i25mvT6QyAhNyEBPd0GYr6JYMemZBGORK0MwJ1Nx"
    "9IUIFd/zR2WpBenPqk+3zg=="
)


def call(prpt_div_cd: str, num: int = 5) -> dict:
    params = {
        "serviceKey": SERVICE_KEY,
        "pageNo": 1,
        "numOfRows": num,
        "resultType": "json",
        "prptDivCd": prpt_div_cd,
        "pvctTrgtYn": "N",
    }
    print(f"\n[REQ] {ENDPOINT}")
    print(f"      prptDivCd={prpt_div_cd}, numOfRows={num}")
    r = requests.get(ENDPOINT, params=params, timeout=15)
    print(f"[RES] HTTP {r.status_code} ({len(r.content)} bytes)")
    print(f"      Content-Type: {r.headers.get('Content-Type')}")
    text = r.text
    # 권한 미승인/키 오류는 XML 로 떨어지는 경우 많음
    if not text.lstrip().startswith("{"):
        print("[WARN] JSON 아님 — XML/HTML 응답 (권한·키 문제 의심)")
        print(text[:1500])
        return {}
    return r.json()


def show_summary(resp: dict, label: str):
    body = resp.get("body", {})
    header = resp.get("header", {})
    code = header.get("resultCode")
    msg = header.get("resultMsg")
    total = body.get("totalCount")
    print(f"\n=== {label} ===")
    print(f"  resultCode={code}  resultMsg={msg}  totalCount={total}")
    if code != "00":
        return
    items = body.get("items") or []
    if isinstance(items, dict):
        items = items.get("item", [])
    if not isinstance(items, list):
        items = [items]
    print(f"  items={len(items)}")
    for i, it in enumerate(items[:3], 1):
        print(f"\n  [{i}] {it.get('onbidCltrNm')}")
        print(f"      cltrMngNo : {it.get('cltrMngNo')}")
        print(f"      ltnoPnu   : {it.get('ltnoPnu')}  ({len(str(it.get('ltnoPnu') or ''))}자리)")
        print(f"      rdnmPnu   : {it.get('rdnmPnu')}")
        print(f"      주소      : {it.get('lctnSdnm')} {it.get('lctnSggnm')} {it.get('lctnEmdNm')}")
        print(f"      재산유형  : {it.get('prptDivNm')}")
        print(f"      입찰상태  : {it.get('pbctStatNm')}")
        print(f"      감정가    : {it.get('apslEvlAmt'):,}원" if it.get('apslEvlAmt') else "      감정가    : -")
        print(f"      최저입찰  : {it.get('lowstBidPrcIndctCont')}")
        print(f"      입찰기간  : {it.get('cltrBidBgngDt')} ~ {it.get('cltrBidEndDt')}")
        print(f"      토지면적  : {it.get('landSqms')} m²")
        print(f"      건물면적  : {it.get('bldSqms')} m²")


def main():
    # 압류재산이 가장 흔하고 입찰 진행 중인 케이스가 많음
    resp = call("0007", num=5)
    if resp:
        show_summary(resp, "압류재산 (0007)")
        # raw 1건 덤프
        try:
            raw_item = resp["body"]["items"]["item"][0]
            print("\n--- RAW item[0] (필드 전체) ---")
            pprint(raw_item)
        except (KeyError, IndexError, TypeError):
            pass

    # 보너스: 국유재산도 한번 (지방세 압류 매물 vs 국유 매물 비교용)
    resp2 = call("0010", num=3)
    if resp2:
        show_summary(resp2, "국유재산 (0010)")


if __name__ == "__main__":
    main()
