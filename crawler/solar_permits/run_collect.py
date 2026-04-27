"""
전국 태양광 발전소 전기사업 허가정보 수집기 — 진입점.

흐름:
  1) bjd_master 캐시 메모리 로드 (cache_loader 경유 — GH Cache HIT)
  2) data.go.kr API 페이지 1~N 다운로드 (총 ~12만 건)
  3) 각 행:
     - parse_lotno_addr → (sep_1~5, jibun)         (번지 없는 행 skip)
     - bjd_lookup(sep) → bjd_code                   (룩업 실패 행 skip)
     - to_pnu(bjd_code, jibun) → PNU 19자리         (조립 실패 행 skip)
  4) solar_permits TRUNCATE + 청크 INSERT (~9만 건)

환경변수:
  DATA_GO_KR_KEY              필수
  SUPABASE_URL                필수
  SUPABASE_SERVICE_KEY        필수
  BJD_MASTER_CACHE_FILE       선택 (GH Actions 에서 cache 파일 경로 주입)
  SOLAR_PERMITS_PAGE_SIZE     선택 (기본 1000)
  SOLAR_PERMITS_MAX_PAGES     선택 (기본 무제한 — 시범/디버그용)

실행:
  cd crawler && python solar_permits/run_collect.py
"""
import logging
import os
import sys
import time
from pathlib import Path

import requests

# crawler/ 와 crawler/solar_permits/ 둘 다 sys.path 에 추가
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))   # crawler/ — cache_loader, bjd_lookup, pnu_builder
sys.path.insert(0, str(HERE))          # crawler/solar_permits/ — 자체 모듈

# Windows cp949 stdout 회피
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from api_client import fetch_page                  # noqa: E402
from parse_addr import parse_lotno_addr            # noqa: E402
from bjd_lookup import lookup as bjd_lookup        # noqa: E402
from pnu_builder import to_pnu                      # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("solar_permits")

CHUNK = 1000  # INSERT 청크 크기 (Supabase PostgREST 권장 한도 내)


# ─────────────────────────────────────────────
# Supabase REST 헬퍼
# ─────────────────────────────────────────────
def _supa_headers() -> dict:
    key = os.environ["SUPABASE_SERVICE_KEY"]
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _supa_url() -> str:
    return os.environ["SUPABASE_URL"].rstrip("/")


def truncate_solar_permits() -> None:
    """솔라 테이블 전체 삭제. PostgREST DELETE + 안전 필터(id>=0)."""
    url = f"{_supa_url()}/rest/v1/solar_permits?id=gte.0"
    headers = {**_supa_headers(), "Prefer": "return=minimal"}
    r = requests.delete(url, headers=headers, timeout=120)
    if r.status_code not in (200, 204):
        raise RuntimeError(f"TRUNCATE 실패 {r.status_code}: {r.text[:300]}")
    log.info("solar_permits 비움 완료")


def insert_chunk(rows: list[dict], retries: int = 3) -> int:
    """청크 INSERT. 성공 시 len(rows), 실패 시 0."""
    if not rows:
        return 0
    url = f"{_supa_url()}/rest/v1/solar_permits"
    headers = {**_supa_headers(), "Prefer": "return=minimal"}
    last_err = None
    for attempt in range(retries):
        try:
            r = requests.post(url, headers=headers, json=rows, timeout=60)
            if r.status_code in (200, 201, 204):
                return len(rows)
            last_err = f"HTTP {r.status_code}: {r.text[:300]}"
        except requests.RequestException as e:
            last_err = str(e)
        if attempt < retries - 1:
            time.sleep(2 ** attempt)
    log.error(f"INSERT 실패 (rows={len(rows)}): {last_err}")
    return 0


# ─────────────────────────────────────────────
# raw item → DB row 변환
# ─────────────────────────────────────────────
def _clean(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


def _parse_num(v):
    if v is None or v == "":
        return None
    try:
        n = float(str(v).strip())
        return n if n == n else None
    except (ValueError, TypeError):
        return None


def _parse_date(v) -> str | None:
    """'2024-04-01' / '20240401' / '2024.04.01' → 'YYYY-MM-DD'"""
    s = _clean(v)
    if not s:
        return None
    import re
    digits = re.sub(r"\D", "", s)
    if len(digits) == 8:
        return f"{digits[0:4]}-{digits[4:6]}-{digits[6:8]}"
    return None


# ─────────────────────────────────────────────
# 메인
# ─────────────────────────────────────────────
def main() -> int:
    if not os.environ.get("DATA_GO_KR_KEY"):
        log.error("DATA_GO_KR_KEY 환경변수 필수")
        return 1
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_SERVICE_KEY"):
        log.error("SUPABASE_URL / SUPABASE_SERVICE_KEY 환경변수 필수")
        return 1

    page_size = min(1000, max(1, int(os.environ.get("SOLAR_PERMITS_PAGE_SIZE", "1000"))))
    max_pages_env = os.environ.get("SOLAR_PERMITS_MAX_PAGES")
    max_pages = int(max_pages_env) if max_pages_env else None

    started = time.time()
    log.info(f"수집 시작 (page_size={page_size}, max_pages={max_pages})")

    # 통계
    skip_no_lotno = 0      # 시설명 또는 지번주소 누락
    skip_no_bunji = 0      # 번지 토큰 없음 (영통동 류)
    skip_no_bjd = 0        # bjd_master 룩업 실패
    skip_pnu_fail = 0      # PNU 조립 실패
    rows_to_insert: list[dict] = []
    fetched_pages = 0
    total_count = 0

    # 1) 첫 페이지 → totalCount
    total_count, first_items = fetch_page(1, page_size)
    log.info(f"외부 API totalCount = {total_count:,}")
    if total_count == 0:
        log.warning("totalCount=0 → 종료")
        return 0

    n_pages = (total_count + page_size - 1) // page_size
    if max_pages:
        n_pages = min(n_pages, max_pages)
    log.info(f"수집 대상: {n_pages} 페이지 × {page_size} = ~{n_pages * page_size:,} 건")

    # 2) 페이지 순회 + 변환 (메모리 누적)
    for page in range(1, n_pages + 1):
        items = first_items if page == 1 else fetch_page(page, page_size)[1]
        fetched_pages += 1

        page_added = 0
        for raw in items:
            facility_name = _clean(raw.get("solarGenFcltNm"))
            lotno_raw = _clean(raw.get("lctnLotnoAddr"))
            if not facility_name or not lotno_raw:
                skip_no_lotno += 1
                continue

            parsed = parse_lotno_addr(lotno_raw)
            if parsed is None:
                skip_no_bunji += 1
                continue
            sep, jibun = parsed

            bjd_code = bjd_lookup(*sep)
            if not bjd_code:
                skip_no_bjd += 1
                continue

            try:
                pnu = to_pnu(bjd_code, jibun)
            except ValueError:
                skip_pnu_fail += 1
                continue

            if len(pnu) != 19:
                skip_pnu_fail += 1
                continue

            lat = _parse_num(raw.get("latitude"))
            lng = _parse_num(raw.get("longitude"))
            if lat is not None and lng is not None and abs(lat) < 0.001 and abs(lng) < 0.001:
                lat = None
                lng = None

            rows_to_insert.append({
                "pnu": pnu,
                "bjd_code": bjd_code,
                "facility_name": facility_name,
                "capacity_kw": _parse_num(raw.get("capa")),
                "operating_status": _clean(raw.get("oprtngSttsSeNm")),
                "permit_date": _parse_date(raw.get("prmsnYmd")),
                "lat": lat,
                "lng": lng,
                "raw_addr": lotno_raw,
            })
            page_added += 1

        log.info(
            f"page {page:>3}/{n_pages}: fetched={len(items)}, "
            f"적재후보 누적={len(rows_to_insert):,}, "
            f"skip(번지없음/룩업실패/PNU실패)={skip_no_bunji}/{skip_no_bjd}/{skip_pnu_fail}"
        )

    # 3) DB 쓰기 — TRUNCATE + 청크 INSERT
    if not rows_to_insert:
        log.error("적재할 행이 0개 — 중단")
        return 1

    log.info(f"수집 완료. 총 적재 후보 {len(rows_to_insert):,} 건. DB 쓰기 시작.")
    truncate_solar_permits()

    inserted = 0
    for i in range(0, len(rows_to_insert), CHUNK):
        chunk = rows_to_insert[i:i + CHUNK]
        n = insert_chunk(chunk)
        inserted += n
        pct = inserted / len(rows_to_insert) * 100
        log.info(f"  [{inserted:>6,}/{len(rows_to_insert):,}] {pct:5.1f}%")

    elapsed = time.time() - started
    log.info(
        f"전체 완료. 적재 {inserted:,}건 / "
        f"skip(시설명/번지/룩업/PNU)={skip_no_lotno}/{skip_no_bunji}/{skip_no_bjd}/{skip_pnu_fail}, "
        f"{fetched_pages}페이지, 소요 {elapsed:.1f}초"
    )
    return 0 if inserted == len(rows_to_insert) else 1


if __name__ == "__main__":
    sys.exit(main())
