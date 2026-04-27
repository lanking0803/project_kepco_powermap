"""
PNU 19자리 직접 조립 모듈.

행안부 표준 PNU 구조:
  PNU = bjd_code(10) + 산구분(1) + 본번(4 zero-padded) + 부번(4 zero-padded)

  ⚠ 산구분: 1=일반, 2=산  (행안부 표준 — 0/1 이 아님)

검증 이력 (test_pnu_construction.py):
  KEPCO 데이터 100건 무작위 샘플 → VWorld WFS 실측 매칭률 ~93%
  TS 포팅본: web/lib/geo/pnu.ts (buildPnuFromBjdAndJibun)

사용처:
  - crawler/solar_permits/  → 수집 시 PNU 조립 후 DB 저장
  - crawler/test_pnu_construction.py → 알고리즘 검증 (현재 위치 그대로 유지)
  - 향후 KEPCO 워커도 동일 함수 사용 가능

알고리즘 변경 시 이 파일만 수정하면 모든 사용처 자동 반영.
"""


def to_pnu(bjd_code: str, jibun: str) -> str:
    """
    (bjd_code, jibun) → PNU 19자리.

    Args:
        bjd_code: 법정동코드 10자리 (행정구역 식별자)
        jibun:    지번 표기. 다음 형식 모두 지원:
                  "1"      → 본번 1, 부번 0
                  "1-2"    → 본번 1, 부번 2
                  "산 1-2" → 산구분 2, 본번 1, 부번 2
                  "산1-2"  → 동일 (띄어쓰기 무시)

    Returns:
        19자리 PNU 문자열.

    Raises:
        ValueError: jibun 빈값 / 본번 숫자 추출 실패 / 본번·부번 4자리 초과.
    """
    if not jibun:
        raise ValueError("jibun 빈값")

    # 산 지번 판별 + 정규화
    rest = jibun.strip()
    is_san = rest.startswith("산")
    if is_san:
        rest = rest.lstrip("산").strip()

    # 본번-부번 분해
    parts = rest.split("-", 1)
    bonbun_raw = parts[0].strip()
    bubun_raw = parts[1].strip() if len(parts) > 1 else "0"

    # 숫자만 추출 (한자/영문 혼용 방어)
    bonbun_digits = "".join(c for c in bonbun_raw if c.isdigit())
    bubun_digits = "".join(c for c in bubun_raw if c.isdigit())

    if not bonbun_digits:
        raise ValueError(f"본번 숫자 없음: '{jibun}'")

    bonbun = bonbun_digits.zfill(4)
    bubun = (bubun_digits or "0").zfill(4)

    if len(bonbun) > 4 or len(bubun) > 4:
        raise ValueError(f"본번/부번 4자리 초과: '{jibun}'")

    # 11번째 자리: 1=일반, 2=산
    return f"{bjd_code}{'2' if is_san else '1'}{bonbun}{bubun}"
