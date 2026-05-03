"""중복 매물 — 같은 사건의 row 들이 실제로 어떻게 다른지 모든 필드 비교."""
import io
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

base = Path(__file__).parent.parent / "docs" / "api_specs" / "하이픈_부동산법원경매정보"

# 모든 v5 응답을 합쳐서 사건 단위 그룹화
all_items = []
for f in sorted(base.glob("_test_v5_*.json")):
    if "courts" in f.name:
        continue
    data = json.loads(f.read_text(encoding="utf-8"))
    items = (data.get("data") or {}).get("data") or []
    for it in items:
        it["__src"] = f.name
        all_items.append(it)

# 사건번호코드 단위로 묶기
by_case = defaultdict(list)
for it in all_items:
    by_case[it["사건번호코드"]].append(it)

# 같은 사건에 row 가 2개 이상 들어온 케이스만
print("=" * 80)
print("같은 사건의 여러 row — 어떤 필드가 다른지 비교")
print("=" * 80)
for case_code, rows in by_case.items():
    if len(rows) < 2:
        continue
    # 같은 row 가 여러 응답에 등장할 수 있으니 (사건번호코드, 경매번호) 으로 unique
    unique = {}
    for r in rows:
        unique[r["경매번호"]] = r
    if len(unique) < 2:
        continue

    print(f"\n--- 사건번호코드 {case_code} — 물건 {len(unique)}개 ---")
    sample_case = next(iter(unique.values()))
    print(
        f"    사건명칭={sample_case['사건년도']}타경{sample_case['사건번호']}, "
        f"법원={sample_case['법원간략명']}"
    )
    print(
        f"    {'경매번호':>10} {'물건번호':>5} {'진행상태':<6} "
        f"{'유찰수':>4} {'토지㎡':>8} {'건물㎡':>8} {'감정가':>15} "
        f"{'리스트지번주소'}"
    )
    for r in sorted(unique.values(), key=lambda x: x["물건번호"]):
        try:
            gam = float(r.get("감정가") or 0)
        except (ValueError, TypeError):
            gam = 0.0
        land = r.get("토지면적") if r.get("토지면적") is not None else "-"
        bld = r.get("건물면적") if r.get("건물면적") is not None else "-"
        addr = r.get("리스트지번주소") or r.get("대표소재지") or ""
        print(
            f"    {r['경매번호']:>10} {r['물건번호']:>5} {r['진행상태']:<6} "
            f"{r['유찰수']:>4} {str(land):>8} {str(bld):>8} {gam:>15,.0f} "
            f"{addr[:40]}"
        )
