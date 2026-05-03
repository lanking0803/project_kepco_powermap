"""
사용자 화면 재현 — 고양시 일산서구 + 매각기일 5/3~6/3, page 1 만 받아서
응답 raw 첫 4건 모든 필드 출력.

스크린샷의 4건이 모두 "2023타경1360 / 79,400만원 / 토지 48㎡ / 1050-185" 였음.
응답 raw 가 어떻게 들어오는지 확인.
"""
import io
import json
import sys
import time
from pathlib import Path

import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

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


def main():
    print("=" * 78)
    print("사용자 화면 재현 — 고양시 일산서구 page 1, 매각기일 5/3~6/3")
    print("=" * 78)

    payload = {
        "sido": "41",
        "gugun": "41287",
        "page": "1",
        "sday_s": "2026-05-03",
        "sday_e": "2026-06-03",
    }
    print(f"[REQ] body={json.dumps(payload, ensure_ascii=False)}")
    r = requests.post(
        f"{BASE}/au0147001252",
        headers=HEADERS,
        json=payload,
        timeout=30,
    )
    data = r.json()
    common = data.get("common") or {}
    print(f"[RES] errYn={common.get('errYn')} errCd={common.get('errCd')}")

    body = data.get("data") or {}
    items = body.get("data") or []
    print(f"\n매물 수: {len(items)} / totallist={body.get('totallist')} / totalpage={body.get('totalpage')}")

    out = OUT_DIR / "_test_v5_99_user_screen.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  → 저장: {out.name}")

    # 첫 4건 모든 필드 출력
    print("\n" + "─" * 78)
    print("첫 4건 — 모든 필드 비교")
    print("─" * 78)
    keys = set()
    for it in items[:4]:
        keys.update(it.keys())

    for k in sorted(keys):
        vals = [it.get(k) for it in items[:4]]
        if len(set(json.dumps(v, ensure_ascii=False) for v in vals)) == 1:
            print(f"  [SAME]  {k:<14} = {vals[0]}")
        else:
            print(f"  [DIFF]  {k:<14}")
            for i, v in enumerate(vals):
                print(f"          [{i}] = {v}")

    # 사건 단위 그룹화 — 같은 사건이 몇 건씩 들어왔나
    from collections import Counter
    case_counter = Counter()
    for it in items:
        case = f"{it.get('사건년도')}타경{it.get('사건번호')}"
        case_counter[case] += 1
    print("\n--- page 1 의 사건 분포 ---")
    for case, n in case_counter.most_common():
        print(f"  {case}: {n}건")


if __name__ == "__main__":
    main()
