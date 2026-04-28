"""
전국 태양광 발전소 전기사업 허가정보 수집기 — 단일 파일.

매월 1일 03:00 KST GitHub Actions cron + 수동 dispatch.
흐름:
  1) data.go.kr API 페이지 1~N 다운로드 (~12만 건)
  2) 각 행: 한글주소 → PNU (pnu_builder.address_to_pnu)
  3) BJD 별 그룹화 → Supabase Storage 'solar-permits' bucket 업로드 (~5,000 파일)

핵심 기술 (PNU 매칭) 은 pnu_builder.py 가 담당. 본 파일은 수집·변환·적재만.

저장소 변경 이력:
  v1: solar_permits 테이블 (TRUNCATE + INSERT) — 디스크 23 MB
  v2: Storage bucket 'solar-permits' (파일별 BJD JSON, public) — 디스크 0, Smart CDN

환경변수:
  DATA_GO_KR_KEY              필수
  SUPABASE_URL                필수
  SUPABASE_SERVICE_KEY        필수 (service_role)
  BJD_MASTER_CACHE_FILE       선택 (GH Actions 가 cache 경로 주입)
  SOLAR_PERMITS_PAGE_SIZE     선택 (기본 1000)
  SOLAR_PERMITS_MAX_PAGES     선택 (기본 무제한 — 시범 / 디버그용)
  SOLAR_STORAGE_BUCKET        선택 (기본 'solar-permits')

실행:
  cd crawler && python solar_permits.py
"""
import json
import logging
import os
import re
import sys
import time
from collections import defaultdict

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
PAGE_SLEEP_SEC = 0.3   # 페이지 간 휴식 — 외부 서버 부담 완화
STORAGE_BUCKET = os.environ.get("SOLAR_STORAGE_BUCKET", "solar-permits")

# 세션 재사용 — TCP keep-alive 로 연결 안정성 / 속도 향상
_session = requests.Session()
_session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})


# ─────────────────────────────────────────────
# 외부 API — data.go.kr 페이지 단위
# ─────────────────────────────────────────────

def fetch_page(page: int, size: int = 1000, retries: int = 5) -> tuple[int, list[dict]]:
    """data.go.kr 페이지 단위 fetch.

    재시도 정책 (1, 2, 4, 8, 16초 지수 백오프) — 외부 서버 일시 불안정 대비.

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

    last_err = None
    for attempt in range(retries):
        try:
            r = _session.get(ENDPOINT, params=params, timeout=60)
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
# Supabase Storage 헬퍼 (REST API 직접 호출 — requests 컨벤션 일관성)
# ─────────────────────────────────────────────

def _supa_key() -> str:
    return os.environ["SUPABASE_SERVICE_KEY"]


def _supa_url() -> str:
    return os.environ["SUPABASE_URL"].rstrip("/")


def _storage_auth_headers() -> dict:
    key = _supa_key()
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }


def list_storage_files() -> list[str]:
    """bucket 내 모든 파일명 (전체 목록 페이지 처리)."""
    url = f"{_supa_url()}/storage/v1/object/list/{STORAGE_BUCKET}"
    headers = {**_storage_auth_headers(), "Content-Type": "application/json"}
    out: list[str] = []
    offset = 0
    page_size = 1000
    while True:
        body = {"limit": page_size, "offset": offset, "prefix": ""}
        r = requests.post(url, headers=headers, json=body, timeout=60)
        if r.status_code != 200:
            raise RuntimeError(f"Storage list 실패 {r.status_code}: {r.text[:300]}")
        items = r.json() or []
        out.extend(item["name"] for item in items if item.get("name"))
        if len(items) < page_size:
            break
        offset += page_size
    return out


def cleanup_storage_bucket() -> int:
    """bucket 의 모든 파일 삭제 (TRUNCATE 효과). 청크 단위 삭제."""
    names = list_storage_files()
    if not names:
        return 0

    url = f"{_supa_url()}/storage/v1/object/{STORAGE_BUCKET}"
    headers = {**_storage_auth_headers(), "Content-Type": "application/json"}
    deleted = 0
    chunk_size = 500
    for i in range(0, len(names), chunk_size):
        chunk = names[i:i + chunk_size]
        r = requests.delete(url, headers=headers, json={"prefixes": chunk}, timeout=120)
        if r.status_code not in (200, 204):
            raise RuntimeError(f"Storage delete 실패 {r.status_code}: {r.text[:300]}")
        deleted += len(chunk)
    return deleted


def upload_bjd_json(bjd_code: str, rows: list[dict], retries: int = 3) -> int:
    """단일 BJD JSON 파일 업로드. upsert (덮어쓰기). 반환 = byte 크기."""
    url = f"{_supa_url()}/storage/v1/object/{STORAGE_BUCKET}/{bjd_code}.json"
    payload = json.dumps(rows, ensure_ascii=False).encode("utf-8")
    headers = {
        **_storage_auth_headers(),
        "Content-Type": "application/json",
        "x-upsert": "true",
        "Cache-Control": "max-age=3600",
    }
    last_err = None
    for attempt in range(retries):
        try:
            r = requests.post(url, headers=headers, data=payload, timeout=60)
            if r.status_code in (200, 201):
                return len(payload)
            last_err = f"HTTP {r.status_code}: {r.text[:200]}"
        except requests.RequestException as e:
            last_err = str(e)
        if attempt < retries - 1:
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Storage 업로드 실패 ({bjd_code}.json): {last_err}")


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

def _fmt_dur(sec: float) -> str:
    """초 → '18분 32초' / '1시간 5분' 사람이 읽기 쉬운 표기."""
    sec = int(sec)
    if sec < 60:
        return f"{sec}초"
    if sec < 3600:
        return f"{sec // 60}분 {sec % 60}초"
    return f"{sec // 3600}시간 {(sec % 3600) // 60}분"


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

    log.info("=" * 60)
    log.info(" 솔라 발전소 허가정보 수집")
    log.info("=" * 60)
    log.info(f"  설정: page_size={page_size:,}, max_pages={max_pages or '무제한'}")
    log.info("")

    skip_no_addr = 0    # 시설명 또는 지번주소 빈값 (대부분 지번주소 없음)
    skip_pnu_fail = 0   # address_to_pnu 실패 (오염주소 + 행정명 변경 등)
    rows_to_insert: list[dict] = []
    fetched_pages = 0

    # ── STAGE 1/3 ──────────────────────────────
    log.info("[STAGE 1/3] 외부 API 메타정보 조회")
    stage1_started = time.time()

    total_count, first_items = fetch_page(1, page_size)
    if total_count == 0:
        log.warning("  외부 API totalCount=0 → 종료")
        return 0

    n_pages = (total_count + page_size - 1) // page_size
    if max_pages:
        n_pages = min(n_pages, max_pages)

    log.info(f"  외부 API 총 건수: {total_count:,} 건")
    log.info(f"  수집 계획     : {n_pages} 페이지 × {page_size:,} 건 = ~{n_pages * page_size:,} 건")
    log.info(f"  STAGE 1 완료 — {_fmt_dur(time.time() - stage1_started)}")
    log.info("")

    # ── STAGE 2/3 ──────────────────────────────
    log.info("[STAGE 2/3] 페이지 단위 수집 + PNU 매칭")
    stage2_started = time.time()

    for page in range(1, n_pages + 1):
        if page == 1:
            items = first_items
        else:
            time.sleep(PAGE_SLEEP_SEC)   # 외부 서버 부담 완화
            items = fetch_page(page, page_size)[1]
        fetched_pages += 1

        for raw in items:
            facility_name = _clean(raw.get("solarGenFcltNm"))
            lotno_raw = _clean(raw.get("lctnLotnoAddr"))
            if not facility_name or not lotno_raw:
                skip_no_addr += 1
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

        # 누적 매칭률 (적재후보 / 받은건수) — 외부 데이터 품질 한눈에 파악
        seen = page * page_size if page < n_pages else (page - 1) * page_size + len(items)
        match_pct = len(rows_to_insert) / seen * 100 if seen else 0
        log.info(
            f"  page {page:>3}/{n_pages} │ 받음 {len(items):>4,} │ "
            f"적재누적 {len(rows_to_insert):>6,} ({match_pct:4.1f}%) │ "
            f"skip 누적: 주소빈값 {skip_no_addr:>5,} + PNU실패 {skip_pnu_fail:>5,}"
        )

    stage2_elapsed = time.time() - stage2_started
    total_seen = (fetched_pages - 1) * page_size + len(items) if fetched_pages else 0
    final_match_pct = len(rows_to_insert) / total_seen * 100 if total_seen else 0
    skip_addr_pct = skip_no_addr / total_seen * 100 if total_seen else 0
    skip_pnu_pct = skip_pnu_fail / total_seen * 100 if total_seen else 0

    log.info("")
    log.info(f"  STAGE 2 완료 — {_fmt_dur(stage2_elapsed)}")
    log.info(f"  ─ 적재 후보   : {len(rows_to_insert):>7,} 건 ({final_match_pct:4.1f}%)")
    log.info(f"  ─ 주소 빈값   : {skip_no_addr:>7,} 건 ({skip_addr_pct:4.1f}%)  ← 외부 API 에 지번주소 없음")
    log.info(f"  ─ PNU 매칭실패: {skip_pnu_fail:>7,} 건 ({skip_pnu_pct:4.1f}%)  ← 오염주소 + 행정명 변경")
    log.info("")

    if not rows_to_insert:
        log.error("적재할 행이 0개 — 중단")
        return 1

    # ── STAGE 3/3 ──────────────────────────────
    log.info(f"[STAGE 3/3] Storage 쓰기 (bucket '{STORAGE_BUCKET}', BJD 별 JSON)")
    stage3_started = time.time()

    # BJD 별 그룹화 — 파일명에 bjd_code 들어가니 row 에서 제거.
    # raw_addr 도 디버깅용이라 Storage 페이로드에는 미포함 (egress 절감).
    bjd_groups: dict[str, list[dict]] = defaultdict(list)
    for r in rows_to_insert:
        bjd_groups[r["bjd_code"]].append({
            "pnu": r["pnu"],
            "facility_name": r["facility_name"],
            "capacity_kw": r["capacity_kw"],
            "operating_status": r["operating_status"],
            "permit_date": r["permit_date"],
            "lat": r["lat"],
            "lng": r["lng"],
        })

    n_bjd = len(bjd_groups)
    avg_per_bjd = len(rows_to_insert) / n_bjd if n_bjd else 0
    log.info(f"  그룹화: {n_bjd:,}개 BJD, 평균 {avg_per_bjd:.1f}건/BJD")

    # 기존 파일 모두 삭제 (TRUNCATE 효과 — 다음 달엔 빈 BJD 가 있을 수도 있어 stale 방지)
    deleted = cleanup_storage_bucket()
    log.info(f"  기존 파일 삭제: {deleted:,}개")

    # 각 BJD 별 업로드
    uploaded = 0
    total_bytes = 0
    failures: list[str] = []
    for bjd, rows in bjd_groups.items():
        # capacity_kw 내림차순 — 라우트 측이 위에서부터 읽기 가독성
        rows_sorted = sorted(rows, key=lambda r: r.get("capacity_kw") or 0, reverse=True)
        try:
            n_bytes = upload_bjd_json(bjd, rows_sorted)
            uploaded += 1
            total_bytes += n_bytes
        except Exception as e:
            failures.append(f"{bjd}: {e}")

        # 진행률 — 매 500개마다
        if uploaded > 0 and uploaded % 500 == 0:
            pct = uploaded / n_bjd * 100
            log.info(f"  업로드 진행 [{uploaded:>5,}/{n_bjd:,}] {pct:5.1f}%")

    stage3_elapsed = time.time() - stage3_started
    log.info("")
    log.info(f"  STAGE 3 완료 — {_fmt_dur(stage3_elapsed)}")
    log.info(f"  ─ 업로드 BJD : {uploaded:,}/{n_bjd:,}개")
    log.info(f"  ─ 총 byte    : {total_bytes / 1024 / 1024:.2f} MB")
    if failures:
        log.warning(f"  ⚠ 업로드 실패 {len(failures)}건 (앞 3건):")
        for msg in failures[:3]:
            log.warning(f"    {msg}")
    log.info("")

    # ── 최종 ──────────────────────────────
    elapsed = time.time() - started
    skipped_total = skip_no_addr + skip_pnu_fail
    skipped_pct = skipped_total / total_seen * 100 if total_seen else 0

    log.info("=" * 60)
    log.info(" 전체 완료")
    log.info("=" * 60)
    log.info(f"  적재   : {uploaded:>7,}개 BJD ({len(rows_to_insert):,}건)")
    log.info(f"  누락   : {skipped_total:>7,}건 ({skipped_pct:4.1f}%, 외부 데이터 결측)")
    log.info(f"  페이지 : {fetched_pages:>7,}개")
    log.info(f"  총소요 : {_fmt_dur(elapsed)}")
    log.info("=" * 60)

    # 5% 이상 실패 = 비정상 (네트워크 에러 등). 그 외는 부분 성공으로 처리.
    if failures and len(failures) > n_bjd * 0.05:
        log.error(f"실패율 5% 초과 ({len(failures)}/{n_bjd}) — 비정상 종료")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
