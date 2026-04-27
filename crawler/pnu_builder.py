"""
한글주소 → PNU 19자리 매칭 — 핵심 기술 모듈.

이 파일은 KEPCO·솔라·검증 도구가 모두 공유하는 단일 유지보수 포인트.
알고리즘 변경 시 이 파일만 수정하면 모든 사용처 자동 반영.

행안부 표준 PNU 구조:
  PNU(19) = bjd_code(10) + 산구분(1) + 본번(4 zero-pad) + 부번(4 zero-pad)

  ⚠ 산구분: 1=일반, 2=산  (행안부 표준 — 0/1 이 아님)

검증 이력 (test_pnu_construction.py):
  KEPCO 데이터 100건 무작위 샘플 → VWorld WFS 실측 매칭률 ~93%
  TS 포팅본: web/lib/geo/pnu.ts (buildPnuFromBjdAndJibun)

공개 함수 3개:
  - parse_address(addr)              : 한글주소 텍스트 → (sep_1~5, jibun)
  - to_pnu(bjd_code, jibun)          : (bjd_code, jibun) → PNU 19자리
  - address_to_pnu(addr, lookup_fn)  : 한방 변환 — 한글주소 → PNU
"""
import re

# ─────────────────────────────────────────────
# 토큰 분류 정규식
# ─────────────────────────────────────────────

# 번지 토큰 시작 패턴:
#   "1234"   숫자 시작
#   "산23"   "산" + 숫자 (붙은 형태)
#   "산"     단독 "산" 토큰 (다음 토큰이 번지)
_BUNJI_START = re.compile(r"^(?:산$|산\d|\d)")


# ─────────────────────────────────────────────
# 1) 한글주소 → (sep_1~5, jibun)
# ─────────────────────────────────────────────

def parse_address(addr: str | None) -> tuple[tuple, str] | None:
    """
    한글 지번주소 → ((sep_1, sep_2, sep_3, sep_4, sep_5), jibun) 또는 None.

    sep_1~5 = 시도 / 일반시 / 자치구·군 / 읍면동 / 리 (KEPCO addr_* 5필드 매핑)
    jibun   = 정규화된 번지 표기 ("1234-5", "산23-5", "1234")

    Returns:
        성공 = ((sep_1, sep_2, sep_3, sep_4, sep_5), jibun)
        실패 = None  (빈 입력 / 시도 누락 / 번지 토큰 없음 — "영통동" 류)

    예:
        "전라남도 신안군 압해읍 학교리 1234-5"
            → (('전라남도', None, '신안군', '압해읍', '학교리'), '1234-5')

        "경상북도 성주군 초전면 어산리 산 19-11 토지"   ('산' 단독 토큰)
            → (('경상북도', None, '성주군', '초전면', '어산리'), '산19-11')

        "경기도 수원시 영통구 영통동"   (번지 없음)
            → None
    """
    if not addr:
        return None
    tokens = addr.split()
    if not tokens:
        return None

    # 전처리: 한글+숫자 붙은 토큰 분리 — "창기리1092-6" → ["창기리", "1092-6"]
    # 외부 데이터 일부 시군구가 띄어쓰기 누락한 케이스. 1글자 행정명/2개 행정명
    # 붙은 케이스는 한국 행정명 컨벤션상 발생 X (오버엔지니어링 회피).
    splitter = re.compile(r"^([가-힣]+(?:리|동|읍|면|구|군|시|가))(\d.*)$")
    processed: list[str] = []
    for t in tokens:
        m = splitter.match(t)
        if m:
            processed.append(m.group(1))
            processed.append(m.group(2))
        else:
            processed.append(t)
    tokens = processed

    sep_1 = tokens[0]
    sep_2 = sep_3 = sep_4 = sep_5 = None
    jibun_tokens: list[str] = []

    for t in tokens[1:]:
        # 번지 토큰 시작 = 그 이후 모든 토큰을 jibun 으로 (호/필지/괄호 등은 _normalize_jibun 에서 처리)
        if _BUNJI_START.match(t) or jibun_tokens:
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
    번지 부분 정규화 → 'N' / 'N-M' / '산N' / '산N-M' 형태.

    예:
      "1067번지 13호 (건물 위)"      → "1067-13"
      "618-20,-24,-26 (3필지)"       → "618-20"   (첫 필지)
      "산 23-5"                      → "산23-5"
      "1234외 5필지"                 → "1234"
    """
    s = raw.strip()
    if not s:
        return None

    # 첫 번째 콤마 / "외" / 공백 + "(" 이전까지만 (여러 필지 → 첫 필지)
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

    # 부번 추출: '-N' (대시) 또는 '번지 N호' / 'N호' 패턴
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


# ─────────────────────────────────────────────
# 2) (bjd_code, jibun) → PNU 19자리
# ─────────────────────────────────────────────

def to_pnu(bjd_code: str, jibun: str) -> str:
    """
    (bjd_code, jibun) → PNU 19자리.

    Args:
        bjd_code: 법정동코드 10자리 (행정구역 식별자)
        jibun:    지번 표기. 다음 형식 모두 지원:
                  "1"      → 본번 1, 부번 0
                  "1-2"    → 본번 1, 부번 2
                  "산 1-2" → 산구분 2, 본번 1, 부번 2
                  "산1-2"  → 동일

    Returns:
        19자리 PNU 문자열.

    Raises:
        ValueError: jibun 빈값 / 본번 숫자 추출 실패 / 본번·부번 4자리 초과.
    """
    if not jibun:
        raise ValueError("jibun 빈값")

    rest = jibun.strip()
    is_san = rest.startswith("산")
    if is_san:
        rest = rest.lstrip("산").strip()

    parts = rest.split("-", 1)
    bonbun_raw = parts[0].strip()
    bubun_raw = parts[1].strip() if len(parts) > 1 else "0"

    bonbun_digits = "".join(c for c in bonbun_raw if c.isdigit())
    bubun_digits = "".join(c for c in bubun_raw if c.isdigit())

    if not bonbun_digits:
        raise ValueError(f"본번 숫자 없음: '{jibun}'")

    bonbun = bonbun_digits.zfill(4)
    bubun = (bubun_digits or "0").zfill(4)

    if len(bonbun) > 4 or len(bubun) > 4:
        raise ValueError(f"본번/부번 4자리 초과: '{jibun}'")

    return f"{bjd_code}{'2' if is_san else '1'}{bonbun}{bubun}"


# ─────────────────────────────────────────────
# 3) 한글주소 → PNU 한방 변환
# ─────────────────────────────────────────────

def address_to_pnu(addr: str, bjd_lookup_fn) -> str | None:
    """
    한글주소 텍스트 → PNU 19자리 (한방 함수).

    Args:
        addr:           한글 지번주소. 예 "전남 신안군 압해읍 학교리 1234-5"
        bjd_lookup_fn:  callable(addr_do, addr_si, addr_gu, addr_dong, addr_li) -> bjd_code|None
                        보통 crawler.bjd_lookup.lookup 함수 전달.

    Returns:
        성공 = PNU 19자리 문자열.
        실패 = None  (입력 빈/형식 깨짐 / 행정구역 룩업 실패 / PNU 조립 실패)
    """
    parsed = parse_address(addr)
    if parsed is None:
        return None
    sep, jibun = parsed

    bjd_code = bjd_lookup_fn(*sep)
    if not bjd_code:
        return None

    try:
        pnu = to_pnu(bjd_code, jibun)
    except ValueError:
        return None
    return pnu if len(pnu) == 19 else None
