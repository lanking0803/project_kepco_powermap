"""
Hyphen 백엔드 검증 v4 — 사건번호코드 ↔ product_id 관계 확정.

검증 항목:
  12. 소재지조회의 사건번호코드를 상세(au0147001254) 의 product_id 로 그대로 사용 가능?
  13. 진행물건검색의 경매번호(1004029) 와 사건번호코드(1479871) 중 어느 것이 product_id 인지 재확인
  14. 소재지조회로 받은 사건번호코드(예: 1479871, 8010) 로 상세 시도

이게 마지막 검증. 결과로 통합 by-pnu 흐름 100% 확정.
"""
import io
import json
import sys
import time
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
    print(f"      errYn={common.get('errYn')} errCd={common.get('errCd')} msg={common.get('errMsg')}")
    return data


def save(name: str, payload: Any) -> None:
    out = OUT_DIR / f"_test_v4_{name}.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"      → {out.name}")


def section(title: str) -> None:
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Hyphen 백엔드 검증 v4 — 사건번호코드 ↔ product_id 관계")

    # ────────────────────────────────────────────────
    # 검증 12-A: 사건번호코드(=1479871, 진행물건검색에서 등장) 를 product_id 로 직접 호출
    # ────────────────────────────────────────────────
    section("[검증 12-A] product_id=1479871 (사건번호코드)")
    print("      v2-6: 진행물건검색의 첫 매물은 경매번호=1004029, 사건번호코드=1479871 였음.")
    print("      v3 검증4: product_id=1004029 (경매번호) 호출 → 성공 (월곶면 고막리 144-11)")
    print("      이번엔 product_id=1479871 (사건번호코드) 시도 → 같은 매물 잡히는지 / 에러인지")
    res_a = call("/au0147001254", {"product_id": "1479871"}, "12-A 사건번호코드")
    save("12A_sno_as_product", res_a)
    common_a = res_a.get("common", {})
    if common_a.get("errYn") == "N":
        d = res_a.get("data", {}).get("data", {})
        print(f"      ✅ 성공. 매물: {d.get('대표소재지', '')} / 사건명칭={d.get('사건명칭')}")
    else:
        print(f"      ❌ 실패: {common_a.get('errMsg')}")

    # ────────────────────────────────────────────────
    # 검증 12-B: 소재지조회 응답의 사건번호코드(=8010, 대명리 347) 로 상세 시도
    # ────────────────────────────────────────────────
    section("[검증 12-B] product_id=8010 (소재지조회 응답의 사건번호코드)")
    res_b = call("/au0147001254", {"product_id": "8010"}, "12-B sojaesch 사건번호코드")
    save("12B_sojaesch_sno", res_b)
    common_b = res_b.get("common", {})
    if common_b.get("errYn") == "N":
        d = res_b.get("data", {}).get("data", {})
        print(f"      ✅ 성공. 매물: {d.get('대표소재지', '')} / 사건명칭={d.get('사건명칭')}")
    else:
        print(f"      ❌ 실패: {common_b.get('errMsg')}")

    # ────────────────────────────────────────────────
    # 결과 종합
    # ────────────────────────────────────────────────
    section("[결과 종합]")
    if common_a.get("errYn") == "N" and common_b.get("errYn") == "N":
        print("      ✅ 사건번호코드 = product_id 동일 (양쪽 모두 직접 사용 가능)")
        print("      → 흐름: 소재지조회 → 사건번호코드 → 상세 (변환 없이 N+1)")
    elif common_a.get("errYn") == "N" and common_b.get("errYn") == "Y":
        print("      ⚠️ 1479871 만 통하고 8010 은 안 됨")
        print("      → 진행물건검색의 사건번호코드는 product_id 와 호환, 소재지조회는 다른 식별자")
    elif common_a.get("errYn") == "Y" and common_b.get("errYn") == "Y":
        print("      ❌ 사건번호코드 ≠ product_id")
        print("      → 별도 변환 호출 필요 (사건번호코드 → 경매번호 매핑 API)")
        print("      → 또는 소재지조회 대신 진행물건검색 + 후필터링 흐름 채택 필요")
    else:
        print("      🤔 예상치 못한 조합. 응답 다시 분석 필요")

    print("\n" + "=" * 70)
    print("검증 v4 완료")
    print("=" * 70)


if __name__ == "__main__":
    main()
