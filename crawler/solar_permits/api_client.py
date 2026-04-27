"""
data.go.kr 태양광 허가정보 API 페이지 단위 호출.

외부 API: tn_pubr_public_solar_gen_flct_api (NIA 데이터ID 15107742)
인증: serviceKey = DATA_GO_KR_KEY (운영계정, 일 한도 100,000)

검증 결과 (2026-04-26~27):
  - 검색 필터 미지원 → pageNo + numOfRows + type 만 작동
  - numOfRows 최대 1000
  - 응답 = camelCase JSON (명세 PDF 의 대문자 표기와 다름)
"""
import logging
import os
import time

import requests

logger = logging.getLogger(__name__)

ENDPOINT = "https://api.data.go.kr/openapi/tn_pubr_public_solar_gen_flct_api"
USER_AGENT = "Mozilla/5.0 (compatible; SUNLAP/1.0; +https://sunlap.kr)"


def fetch_page(page: int, size: int = 1000, retries: int = 3) -> tuple[int, list[dict]]:
    """페이지 단위 fetch.

    Returns:
        (total_count, items) — items 는 raw camelCase dict 리스트.
        resultCode '03' (NO_DATA) 는 빈 페이지로 정상 처리 → (0, []).

    Raises:
        RuntimeError: 모든 재시도 실패 / 인증 오류.
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
            wait = 2 ** attempt  # 1, 2, 4초
            logger.warning(
                f"page={safe_page} 재시도 {attempt + 1}/{retries} (대기 {wait}s): {last_err}"
            )
            time.sleep(wait)

    raise RuntimeError(f"data.go.kr fetch 실패 (page={safe_page}): {last_err}")
