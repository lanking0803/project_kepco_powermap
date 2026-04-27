"""
태양광 발전소 지번주소 → (sep_1~5, jibun) 분리.

입력 예:
  "전라남도 신안군 압해읍 학교리 1234-5"
   →  sep = ('전라남도', None, '신안군', '압해읍', '학교리')
       jibun = '1234-5'

  "경기도 수원시 영통구 영통동"            (번지 없음 — 적재 대상 X)
   →  None

  "전라남도 화순군 도곡면 월곡리 1067번지 13호 (건물 위)"
   →  sep = ('전라남도', None, '화순군', '도곡면', '월곡리')
       jibun = '1067-13'                  (번지 + 호 → 본번-부번)

  "충청남도 태안군 소원면 송현리 618-20,-24,-26 (3필지)"
   →  sep = ('충청남도', None, '태안군', '소원면', '송현리')
       jibun = '618-20'                   (첫 필지만)

  "경기도 안성시 죽산면 용설리 산23-5"
   →  sep = ('경기도', None, None, '죽산면', '용설리')
       jibun = '산23-5'                    ('산' 그대로 보존 → pnu_builder 가 처리)

룰:
  sep_1~5 토큰 파싱은 import_bjd_master.split_sep5 와 동일 (접미사 기반).
  번지 토큰부터 = jibun. 번지 토큰 패턴 = 숫자 시작 또는 '산' 시작.
  번지 안의 변형 표기('번지', '호', 괄호, 콤마) 는 정규화해서 본번-부번 추출.
"""
import re

_BUNJI_START = re.compile(r"^(?:산\s*)?\d")


def _is_bunji_token(tok: str) -> bool:
    """토큰 첫 글자가 숫자 또는 '산'+숫자 면 번지 시작."""
    return bool(_BUNJI_START.match(tok))


def parse_lotno_addr(addr: str | None) -> tuple[tuple, str] | None:
    """
    지번주소 → (sep_1~5 tuple, jibun) 또는 None.

    Returns:
        ((sep_1, sep_2, sep_3, sep_4, sep_5), jibun) — 번지 있는 정상 케이스.
        None — 번지 없음 / 빈값 / 시도 누락.
    """
    if not addr:
        return None
    tokens = addr.split()
    if not tokens:
        return None

    sep_1 = tokens[0]
    sep_2 = sep_3 = sep_4 = sep_5 = None
    jibun_tokens: list[str] = []

    for t in tokens[1:]:
        # 번지 토큰부터 = 지번 부분
        if _is_bunji_token(t) or jibun_tokens:
            jibun_tokens.append(t)
            continue

        # 행정구역 토큰 — 접미사 기반 분류
        if t.endswith("리"):
            sep_5 = t
        elif t.endswith(("읍", "면", "동", "가")):
            sep_4 = t
        elif t.endswith(("구", "군")):
            sep_3 = t
        elif t.endswith("시"):
            sep_2 = t
        else:
            # 세종 등 예외 — sep_4 fallback
            if sep_4 is None:
                sep_4 = t
            else:
                sep_5 = t

    if not jibun_tokens:
        return None

    jibun = _normalize_jibun(" ".join(jibun_tokens))
    if not jibun:
        return None

    return ((sep_1, sep_2, sep_3, sep_4, sep_5), jibun)


def _normalize_jibun(raw: str) -> str | None:
    """
    번지 부분 정규화 → 'N' 또는 'N-M' 또는 '산N' / '산N-M' 형태로.

    예:
      "1067번지 13호 (건물 위)"        → "1067-13"
      "618-20,-24,-26 (3필지)"         → "618-20"
      "산 23-5"                        → "산23-5"
      "1234외 5필지"                   → "1234"
    """
    s = raw.strip()
    if not s:
        return None

    # 첫 번째 콤마 / "외" / 공백 + "(" 이전까지만 사용 (여러 필지 → 첫 필지)
    s = re.split(r"[,(]|\s외\s|\s+\(", s, maxsplit=1)[0].strip()

    # 산 prefix 분리
    is_san = s.startswith("산")
    if is_san:
        s = s.lstrip("산").strip()

    # 본번 추출 (첫 숫자 덩어리)
    m_main = re.match(r"^(\d+)", s)
    if not m_main:
        return None
    bonbun = m_main.group(1)
    rest = s[m_main.end():]

    # 부번 추출: '-' 또는 '번지' 뒤의 숫자 ('호' 도 부번 취급)
    bubun = None
    m_dash = re.search(r"-\s*(\d+)", rest)
    if m_dash:
        bubun = m_dash.group(1)
    else:
        m_ho = re.search(r"(?:번지\s*)?(\d+)\s*호", rest)
        if m_ho:
            bubun = m_ho.group(1)

    out = bonbun if bubun is None else f"{bonbun}-{bubun}"
    return f"산{out}" if is_san else out
