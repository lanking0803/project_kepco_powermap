"""v5 검증 응답에서 중복 매물 패턴 분석."""
import io
import json
import sys
from collections import Counter
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

base = Path(__file__).parent.parent / "docs" / "api_specs" / "하이픈_부동산법원경매정보"
files = sorted(base.glob("_test_v5_*.json"))

for f in files:
    name = f.name
    if "courts" in name:
        continue
    data = json.loads(f.read_text(encoding="utf-8"))
    body = data.get("data") or {}
    items = body.get("data") or []
    if not items:
        continue

    # 사건명칭 단위 카운트
    cases = Counter(f"{it['사건년도']}타경{it['사건번호']}" for it in items)
    dup_cases = [(k, v) for k, v in cases.items() if v > 1]

    print(f"=== {name} — 매물 {len(items)}건 / 사건 {len(cases)}개 ===")
    if dup_cases:
        print(f"  ⚠️ 중복 사건 {len(dup_cases)}건:")
        for case, n in dup_cases:
            print(f"    {case} × {n}회")
            # 그 사건의 row 들 상세
            rows = [
                it for it in items
                if f"{it['사건년도']}타경{it['사건번호']}" == case
            ]
            for r in rows:
                gam = float(r["감정가"]) if r.get("감정가") else 0.0
                print(
                    f"      경매번호={r['경매번호']:>10} 사건번호코드={r['사건번호코드']:>10} "
                    f"물건번호={r['물건번호']} 진행상태={r['진행상태']:<6} "
                    f"유찰수={r['유찰수']} 감정가={gam:,.0f}"
                )
    else:
        print("  중복 없음")
    print()
