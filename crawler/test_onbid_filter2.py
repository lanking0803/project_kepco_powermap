"""
캠코 온비드 추가 필터 + 상세 API 검증.

이전 (test_onbid_filter.py) 검증 통과 항목:
  - 시도/시군구/동 필터 ✓
  - 토지면적 필터 ✓
  - 응답 PNU 100% 채움 ✓

이번 검증 대상 (의뢰자 약속 전):
  1. 카테고리 소분류 코드 cltrUsgSclsCtgrId 작동 여부 (10402=창고시설)
  2. 감정가 필터 apslEvlAmtStart 작동 여부
  3. 입찰기간 필터 bidPrdYmdStart 작동 여부
  4. 상세 API 호출 가능 + potoUrlList 형식 + 사진 URL 작동 여부
"""
import requests
import sys
from datetime import datetime, timedelta
from typing import Optional

LIST_ENDPOINT = "https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2"
DTL_ENDPOINT = "https://apis.data.go.kr/B010003/OnbidRlstDtlSrvc2/getRlstDtlInf2"
SERVICE_KEY = (
    "CWsYAfYYh5I6XFXULGd0/aP6i25mvT6QyAhNyEBPd0GYr6JYMemZBGORK0MwJ1Nx"
    "9IUIFd/zR2WpBenPqk+3zg=="
)


def call_list(label: str, **extra) -> Optional[dict]:
    params = {
        "serviceKey": SERVICE_KEY,
        "pageNo": 1,
        "numOfRows": 5,
        "resultType": "json",
        "prptDivCd": "0007",
        "pvctTrgtYn": "N",
        **extra,
    }
    print(f"\n[{label}]")
    print(f"  params: {extra}")
    try:
        r = requests.get(LIST_ENDPOINT, params=params, timeout=15)
        if r.status_code != 200:
            print(f"  [ERR] HTTP {r.status_code}")
            return None
        if not r.text.lstrip().startswith("{"):
            print(f"  [ERR] JSON 아님: {r.text[:200]}")
            return None
        return r.json()
    except Exception as e:
        print(f"  [ERR] {e}")
        return None


def items_of(resp: Optional[dict]) -> list:
    if not resp:
        return []
    body = resp.get("body", {})
    if body.get("totalCount", 0) == 0:
        return []
    items = body.get("items") or []
    if isinstance(items, dict):
        items = items.get("item", [])
    if not isinstance(items, list):
        items = [items]
    return items


def total_of(resp: Optional[dict]) -> int:
    return resp.get("body", {}).get("totalCount", 0) if resp else 0


def main():
    # 베이스라인 (비교용)
    base = call_list("BASE")
    base_total = total_of(base)
    print(f"  totalCount = {base_total:,}")

    # 1. 카테고리 소분류 — 10402 (창고시설)
    cat = call_list("CAT_소분류 10402(창고시설)", cltrUsgSclsCtgrId="10402")
    cat_total = total_of(cat)
    cat_items = items_of(cat)
    cat_match = 0
    for it in cat_items[:5]:
        nm = it.get("cltrUsgSclsCtgrNm", "")
        if nm == "창고시설":
            cat_match += 1
        print(f"    [응답] cltrUsgSclsCtgrNm = '{nm}'")
    print(f"  totalCount = {cat_total:,}  /  '창고시설' 일치: {cat_match}/{len(cat_items)}")

    # 2. 감정가 필터 — 1억 이상
    apsl = call_list("APSL_감정가 1억+", apslEvlAmtStart="100000000")
    apsl_total = total_of(apsl)
    apsl_items = items_of(apsl)
    apsl_pass = 0
    for it in apsl_items[:5]:
        amt = it.get("apslEvlAmt") or 0
        try:
            amt_n = int(amt)
        except (ValueError, TypeError):
            amt_n = 0
        ok = amt_n >= 100000000
        if ok:
            apsl_pass += 1
        print(f"    [응답] apslEvlAmt = {amt_n:,}원  ({'OK' if ok else 'FAIL'})")
    print(f"  totalCount = {apsl_total:,}  /  1억+ 일치: {apsl_pass}/{len(apsl_items)}")

    # 3. 입찰기간 필터 — 오늘 이후
    today = datetime.now().strftime("%Y%m%d")
    bid = call_list(f"BID_입찰기간 {today}+", bidPrdYmdStart=today)
    bid_total = total_of(bid)
    bid_items = items_of(bid)
    bid_pass = 0
    for it in bid_items[:5]:
        end = it.get("cltrBidEndDt") or ""
        # YYYYMMDDHHmmss 형식
        end_ymd = str(end)[:8]
        ok = end_ymd >= today
        if ok:
            bid_pass += 1
        print(f"    [응답] cltrBidEndDt = {end}  ({'OK' if ok else 'FAIL'})")
    print(f"  totalCount = {bid_total:,}  /  오늘 이후: {bid_pass}/{len(bid_items)}")

    # 4. 상세 API — 베이스라인 첫 매물의 cltrMngNo + pbctCdtnNo 사용
    print("\n[DTL_상세 API]")
    base_items = items_of(base)
    if not base_items:
        print("  [SKIP] 베이스라인에 매물 없음")
        return
    first = base_items[0]
    cltr_no = first.get("cltrMngNo")
    pbct_no = first.get("pbctCdtnNo")
    cltr_nm = first.get("onbidCltrNm", "")
    print(f"  대상: {cltr_nm[:50]}")
    print(f"        cltrMngNo={cltr_no}, pbctCdtnNo={pbct_no}")
    dtl_params = {
        "serviceKey": SERVICE_KEY,
        "pageNo": 1,
        "numOfRows": 1,
        "resultType": "json",
        "cltrMngNo": cltr_no,
    }
    if pbct_no:
        dtl_params["pbctCdtnNo"] = pbct_no
    try:
        r = requests.get(DTL_ENDPOINT, params=dtl_params, timeout=15)
        if r.status_code != 200:
            print(f"  [ERR] HTTP {r.status_code}")
        elif not r.text.lstrip().startswith("{"):
            print(f"  [ERR] JSON 아님: {r.text[:300]}")
        else:
            dtl = r.json()
            dtl_items = items_of(dtl)
            if not dtl_items:
                print(f"  [WARN] 상세 응답 비어있음. resultMsg={dtl.get('header',{}).get('resultMsg')}")
            else:
                d = dtl_items[0]
                # 주요 필드 확인
                photos = d.get("potoUrlList")
                ltno = d.get("ltnoPnu", "")
                land_sq = d.get("landSqms")
                bld_sq = d.get("bldSqms")
                lowst = d.get("lowstBidPrcIndctCont") or d.get("lowstBidPrc")
                print(f"  [응답 OK]")
                print(f"    ltnoPnu = {ltno} ({len(str(ltno))}자리)")
                print(f"    landSqms = {land_sq}")
                print(f"    bldSqms = {bld_sq}")
                print(f"    최저입찰 = {lowst}")
                # 사진
                if photos is None:
                    print(f"    potoUrlList = None (사진 없음)")
                elif isinstance(photos, list):
                    print(f"    potoUrlList = list ({len(photos)}건)")
                    if photos:
                        print(f"      첫 사진: {str(photos[0])[:120]}")
                elif isinstance(photos, dict):
                    print(f"    potoUrlList = dict (XML 단건일 가능성)")
                    print(f"      keys: {list(photos.keys())[:5]}")
                else:
                    print(f"    potoUrlList = {type(photos).__name__}: {str(photos)[:120]}")
                # 추가 필드 일부 출력 (스키마 파악용)
                interesting = ["onbidCltrno", "onbidPbancNo", "pbctNo", "cltrAddDtlAddr", "papsInf"]
                for k in interesting:
                    if k in d:
                        v = d[k]
                        print(f"    {k} = {str(v)[:100]}")
    except Exception as e:
        print(f"  [ERR] 상세 호출 실패: {e}")

    print("\n" + "=" * 60)
    print("판정 (의뢰자 약속 가능 여부)")
    print("=" * 60)
    print(f"  카테고리 소분류 필터: {'OK' if cat_total < base_total and cat_match == len(cat_items) and cat_items else 'FAIL'}")
    print(f"  감정가 필터:         {'OK' if apsl_pass == len(apsl_items) and apsl_items else 'FAIL'}")
    print(f"  입찰기간 필터:       {'OK' if bid_pass == len(bid_items) and bid_items else 'FAIL'}")


if __name__ == "__main__":
    main()
