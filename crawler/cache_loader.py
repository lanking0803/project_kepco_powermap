"""
Supabase 마스터 테이블을 프로세스 메모리로 로드.

우선순위:
  1. 환경변수 BJD_CACHE_FILE 로 지정된 경로가 있으면 해당 파일
  2. 기본 경로 파일이 있으면 해당 파일
     (Windows 로컬 = C:/cache/project_kepco_powermap/<table>.json — 프로젝트가 Google Drive 위라 밖에 둔다,
      그 외(Actions·서버) = .cache/<table>.json)
  3. 둘 다 없으면 Supabase 에서 GET → 파일 저장 후 메모리 로드

GitHub Actions 에서 prep_caches workflow 가 Cache 로 파일을 제공하는 것을 전제.
로컬/개발 환경에서는 Supabase 직접 GET 으로 fallback.

사용 예:
    from cache_loader import load_table
    rows = load_table("bjd_master", "bjd_code,sep_1,sep_2,sep_3,sep_4,sep_5")
"""
import json
import logging
import os
import time
from pathlib import Path

import requests

logger = logging.getLogger(__name__)


# 프로세스 내 캐시 — 테이블별 1회 로드
_MEMO: dict[str, list] = {}


def _cache_path(table: str) -> Path:
    """캐시 파일 경로. 환경변수 override 지원."""
    env_key = f"{table.upper()}_CACHE_FILE"
    override = os.environ.get(env_key)
    if override:
        return Path(override)
    base = Path(r"C:\cache\project_kepco_powermap") if os.name == "nt" else Path(".cache")
    return base / f"{table}.json"


def _get_with_retry(url: str, headers: dict, timeout: int = 60, retries: int = 4) -> requests.Response:
    """5xx 일 때 지수 백오프 재시도."""
    last_err = None
    for attempt in range(retries):
        try:
            r = requests.get(url, headers=headers, timeout=timeout)
            if r.status_code < 500:
                return r
            last_err = f"HTTP {r.status_code}: {r.text[:200]}"
        except requests.exceptions.RequestException as e:
            last_err = str(e)
        if attempt < retries - 1:
            time.sleep(2 ** attempt)  # 1, 2, 4, 8초
    raise RuntimeError(f"Supabase GET failed after {retries} retries: {last_err}")


def _fetch_from_supabase(table: str, columns: str) -> list:
    """PostgREST 기본 max-rows 1000 제약으로 페이지네이션 필수."""
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_KEY"]
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }
    rows: list = []
    page = 1000
    offset = 0
    pages = 0
    t0 = time.time()
    while True:
        r = _get_with_retry(
            f"{url}/rest/v1/{table}"
            f"?select={columns}&limit={page}&offset={offset}",
            headers=headers,
        )
        r.raise_for_status()
        data = r.json()
        if not data:
            break
        rows.extend(data)
        pages += 1
        if len(data) < page:
            break
        offset += page
    elapsed = time.time() - t0
    logger.info(
        f"[cache_loader] {table}: Supabase fetch ({len(rows):,} rows, "
        f"{pages} pages, {elapsed:.1f}s)"
    )
    return rows


def load_table(table: str, columns: str = "*") -> list:
    """
    테이블 전체를 list[dict] 로 반환. 프로세스 내 1회만 실제 로드.

    Args:
        table: Supabase 테이블명
        columns: SELECT 컬럼 (예: "bjd_code,sep_1,sep_2")

    Returns:
        [{"bjd_code": "...", "sep_1": "...", ...}, ...]
    """
    if table in _MEMO:
        return _MEMO[table]

    path = _cache_path(table)

    # 1. 파일 우선
    if path.exists() and path.stat().st_size > 10:
        t0 = time.time()
        rows = json.loads(path.read_text(encoding="utf-8"))
        size_mb = path.stat().st_size / (1024 * 1024)
        logger.info(
            f"[cache_loader] {table}: 파일 로드 {path} "
            f"({len(rows):,} entries, {size_mb:.2f} MB, {time.time() - t0:.2f}s)"
        )
        _MEMO[table] = rows
        return rows

    # 2. Supabase fallback (파일 부재 또는 비어 있음)
    logger.info(f"[cache_loader] {table}: 파일 부재 → Supabase fallback")
    rows = _fetch_from_supabase(table, columns)

    # 파일로 저장 (다음 프로세스 재사용 & actions/cache 자동 업로드 대상)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")

    _MEMO[table] = rows
    return rows


def stats() -> dict:
    """디버그: 메모리 캐시 현황."""
    return {t: len(rows) for t, rows in _MEMO.items()}
