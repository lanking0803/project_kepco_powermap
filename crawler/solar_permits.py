"""
전국 태양광 발전소 전기사업 허가정보 수집기 — 단일 파일.

매월 1일 03:00 KST GitHub Actions cron + 수동 dispatch.
흐름:
  1) data.go.kr API 페이지 1~N 다운로드 (~12만 건)
  2) 각 행: 한글주소 → PNU (pnu_builder.address_to_pnu)
  3) Supabase: solar_permits TRUNCATE + 청크 INSERT (~9만 건)

핵심 기술 (PNU 매칭) 은 pnu_builder.py 가 담당. 본 파일은 수집·변환·적재만.

환경변수:
  DATA_GO_KR_KEY              필수
  SUPABASE_URL                필수
  SUPABASE_SERVICE_KEY        필수
  BJD_MASTER_CACHE_FILE       선택 (GH Actions 가 cache 경로 주입)
  SOLAR_PERMITS_PAGE_SIZE     선택 (기본 1000)
  SOLAR_PERMITS_MAX_PAGES     선택 (기본 무제한 — 시범 / 디버그용)

실행:
  cd crawler && python solar_permits.py
"""
import logging
import os
import re
import sys
import time

import requests

# Windows cp949 stdout 회피
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from pnu_builder import address_to_pnu     # noqa: E402
from bjd_lookup import lookup as bjd_lookup_fn  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("solar_permits")

ENDPOINT = "https://api.data.go.kr/openapi/tn_pubr_public_solar_gen_flct_api"
USER_AGENT = "Mozilla/5.0 (compatible; SUNLAP/1.0; +https://sunlap.kr)"
INSERT_CHUNK = 1000


# ─────────────────────────────────────────────
# 외부 API — data.go.kr 페이지 단위
# ─────────────────────────────────────────────

def fetch_page(page: int, size: int = 1000, retries: int = 3) -> tuple[int, list[dict]]:
    """data.go.kr 페이지 단위 fetch.

    Returns:
        (total_count, items) — items 는 raw camelCase dict 리스트.
        resultCode '03' (NO_DATA) 는 빈 페이지로 정상 처리.
    """
    key = os.environ.get("DATA_GO_KR_KEY", "")
    if not key:
        raise RuntimeError("DATA_GO_KR_KEY 환경변수가 등록되지 않았습니다.")

    safe_page = max(1, int(page))
    safe_size = min(1000, max(1, int(size)))

    params = {
        "serviceKey": key,
        "pageNo": str(safe_page),
        "numOfRows": str(safe_size),
        "type": "json",
    }
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}

    last_err = None
    for attempt in range(retries):
        try:
            r = requests.get(ENDPOINT, params=params, headers=headers, timeout=60)
            text = r.text
            if r.status_code != 200:
                last_err = f"HTTP {r.status_code}: {text[:200]}"
            elif text.lstrip().startswith("<"):
                last_err = f"XML/HTML 응답 (키 의심): {text[:200]}"
            else:
                data = r.json()
                envelope = data.get("response", data)
                code = envelope.get("header", {}).get("resultCode")
                if code and code not in ("00", "0000"):
                    if code == "03":
                        return 0, []
                    last_err = f"API {code}: {envelope.get('header', {}).get('resultMsg', '')}"
                else:
                    body = envelope.get("body", {}) or {}
                    total_count = int(body.get("totalCount", 0) or 0)
                    raw_items = body.get("items", [])
                    if isinstance(raw_items, list):
                        items = raw_items
                    elif isinstance(raw_items, dict):
                        inner = raw_items.get("item", [])
                        items = inner if isinstance(inner, list) else ([inner] if inner else [])
                    else:
                        items = []
                    return total_count, items
        except (requests.RequestException, ValueError) as e:
            last_err = str(e)

        if attempt < retries - 1:
            wait = 2 ** attempt
            log.warning(f"page={safe_page} 재시도 {attempt + 1}/{retries} (대기 {wait}s): {last_err}")
            time.sleep(wait)

    raise RuntimeError(f"data.go.kr fetch 실패 (page={safe_page}): {last_err}")


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
    url = f"{_supa_url()}/rest/v1/solar_permits?id=gte.0"
    headers = {**_supa_headers(), "Prefer": "return=minimal"}
    r = requests.delete(url, headers=headers, timeout=120)
    if r.status_code not in (200, 204):
        raise RuntimeError(f"TRUNCATE 실패 {r.status_code}: {r.text[:300]}")
    log.info("solar_permits 비움 완료")


def insert_chunk(rows: list[dict], retries: int = 3) -> int:
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
# 보조 변환
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
    s = _clean(v)
    if not s:
        return None
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

    skip_no_lotno = 0   # 시설명/지번 빈값
    skip_pnu_fail = 0   # address_to_pnu 실패 (모든 사유 통합)
    rows_to_insert: list[dict] = []
    fetched_pages = 0

    # 첫 페이지 → totalCount
    total_count, first_items = fetch_page(1, page_size)
    log.info(f"외부 API totalCount = {total_count:,}")
    if total_count == 0:
        log.warning("totalCount=0 → 종료")
        return 0

    n_pages = (total_count + page_size - 1) // page_size
    if max_pages:
        n_pages = min(n_pages, max_pages)
    log.info(f"수집 대상: {n_pages} 페이지 × {page_size} = ~{n_pages * page_size:,} 건")

    for page in range(1, n_pages + 1):
        items = first_items if page == 1 else fetch_page(page, page_size)[1]
        fetched_pages += 1

        for raw in items:
            facility_name = _clean(raw.get("solarGenFcltNm"))
            lotno_raw = _clean(raw.get("lctnLotnoAddr"))
            if not facility_name or not lotno_raw:
                skip_no_lotno += 1
                continue

            pnu = address_to_pnu(lotno_raw, bjd_lookup_fn)
            if pnu is None:
                skip_pnu_fail += 1
                continue

            lat = _parse_num(raw.get("latitude"))
            lng = _parse_num(raw.get("longitude"))
            if lat is not None and lng is not None and abs(lat) < 0.001 and abs(lng) < 0.001:
                lat = None
                lng = None

            rows_to_insert.append({
                "pnu": pnu,
                "bjd_code": pnu[:10],
                "facility_name": facility_name,
                "capacity_kw": _parse_num(raw.get("capa")),
                "operating_status": _clean(raw.get("oprtngSttsSeNm")),
                "permit_date": _parse_date(raw.get("prmsnYmd")),
                "lat": lat,
                "lng": lng,
                "raw_addr": lotno_raw,
            })

        log.info(
            f"page {page:>3}/{n_pages}: fetched={len(items)}, "
            f"적재후보 누적={len(rows_to_insert):,}, "
            f"skip(시설명빈값/PNU실패)={skip_no_lotno}/{skip_pnu_fail}"
        )

    if not rows_to_insert:
        log.error("적재할 행이 0개 — 중단")
        return 1

    log.info(f"수집 완료. 총 {len(rows_to_insert):,} 건. DB 쓰기 시작.")
    truncate_solar_permits()

    inserted = 0
    for i in range(0, len(rows_to_insert), INSERT_CHUNK):
        chunk = rows_to_insert[i:i + INSERT_CHUNK]
        n = insert_chunk(chunk)
        inserted += n
        pct = inserted / len(rows_to_insert) * 100
        log.info(f"  [{inserted:>6,}/{len(rows_to_insert):,}] {pct:5.1f}%")

    elapsed = time.time() - started
    log.info(
        f"전체 완료. 적재 {inserted:,}건 / "
        f"skip(시설명빈값/PNU실패)={skip_no_lotno}/{skip_pnu_fail}, "
        f"{fetched_pages}페이지, 소요 {elapsed:.1f}초"
    )
    return 0 if inserted == len(rows_to_insert) else 1


if __name__ == "__main__":
    sys.exit(main())
