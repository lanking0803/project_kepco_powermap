/**
 * 지번 → PNU 19자리 직접 구성.
 *
 * 행안부 표준 PNU = bjd_code(10) + 산구분(1) + 본번(4) + 부번(4)
 *   산구분: 1=일반, 2=산  ⚠️ 0/1 직관과 반대 (실측 검증 완료)
 *
 * 입력은 KEPCO 데이터 포맷 ("1-2", "산23", "산5-7"). 부번 없으면 "0000".
 * 검증 도구 crawler/test_pnu_construction.py 와 동일 알고리즘 (JS 포팅, 실측 매칭률 ~93%).
 */
export function buildPnuFromBjdAndJibun(
  bjdCode: string,
  addrJibun: string | null | undefined,
): string | null {
  if (!/^\d{10}$/.test(bjdCode)) return null;
  const raw = (addrJibun ?? "").trim();
  if (!raw) return null;
  const isSan = raw.startsWith("산");
  const rest = (isSan ? raw.slice(1) : raw).trim();
  const [bonbunStr = "", bubunStr = "0"] = rest.split("-");
  const bonbun = bonbunStr.match(/\d+/)?.[0]?.padStart(4, "0");
  const bubun = bubunStr.match(/\d+/)?.[0]?.padStart(4, "0");
  if (!bonbun || !bubun) return null;
  return `${bjdCode}${isSan ? "2" : "1"}${bonbun}${bubun}`;
}

/**
 * PNU 19자리 → 지번 텍스트 ("36-2", "산23" 등). buildPnuFromBjdAndJibun 의 역변환.
 * 부번 0000 이면 본번만. 형식 오류면 null.
 */
export function jibunFromPnu(pnu: string): string | null {
  if (!/^\d{19}$/.test(pnu)) return null;
  const isSan = pnu.charAt(10) === "2";
  const bonbun = parseInt(pnu.slice(11, 15), 10);
  const bubun = parseInt(pnu.slice(15, 19), 10);
  const text = bubun > 0 ? `${bonbun}-${bubun}` : `${bonbun}`;
  return isSan ? `산${text}` : text;
}
