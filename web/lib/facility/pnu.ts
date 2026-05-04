/**
 * 건축HUB 응답 item → 행안부 표준 PNU 19자리 합성.
 *
 * 응답 item 의 5필드만으로 합성 가능 (외부 호출 0):
 *   sigunguCd(5) + bjdongCd(5) + 산구분(1) + bun(4) + ji(4) = 19
 *
 * ⚠️ 산구분 매핑 (외부 platGbCd → PNU 11번째 자리):
 *   외부 platGbCd: 0=대지, 1=산, 2=블록
 *   PNU 11번째:   1=일반, 2=산
 *   → platGbCd === '1' → '2', 그 외 → '1'
 *
 * 검증 (2026-05-03, 70건 표본):
 *   - 합성 알고리즘 100% 정확 (ldCode/PNU 형식 전부 올바름)
 *   - 매칭률 83% (실패 17% 는 VWorld 지적도 갱신 지연 / 외부 데이터 산지 오표기)
 *
 * skip 조건:
 *   - sigunguCd/bjdongCd 가 5자리 숫자 아님
 *   - bun 이 빈값/0 (메타 row — 빈 platPlc 응답 케이스)
 */
/** 외부 응답 item 의 PNU 합성 필수 필드 — title.ts BrTitleItem 의 부분집합 */
export interface PnuSourceFields {
  sigunguCd?: string | number | null;
  bjdongCd?: string | number | null;
  platGbCd?: string | number | null;
  bun?: string | number | null;
  ji?: string | number | null;
}

/**
 * 건축HUB raw item → PNU 19자리. 합성 불가 시 null.
 *
 * BrTitleItem (raw) 와 BuildingTitleInfo (normalize 후) 가 다른 모양이라,
 * raw 에서 호출하려면 sigunguCd/bjdongCd/platGbCd/bun/ji 를 별도로 받음.
 */
export function buildPnuFromRawItem(it: PnuSourceFields): string | null {
  const sigunguCd = String(it.sigunguCd ?? "").trim();
  const bjdongCd = String(it.bjdongCd ?? "").trim();
  if (!/^\d{5}$/.test(sigunguCd)) return null;
  if (!/^\d{5}$/.test(bjdongCd)) return null;

  const bunDigits = String(it.bun ?? "").replace(/\D/g, "");
  // 본번 0 = 메타 row (빈 platPlc 응답). PNU 합성 X.
  if (!bunDigits || /^0+$/.test(bunDigits)) return null;
  const jiDigits = String(it.ji ?? "").replace(/\D/g, "");

  const bun = bunDigits.padStart(4, "0").slice(-4);
  const ji = (jiDigits || "0").padStart(4, "0").slice(-4);

  // platGbCd '1' = 산지 → PNU 11번째 '2'. 그 외(0/2/빈값) = '1'.
  const platGbCd = String(it.platGbCd ?? "0").trim();
  const sanFlag = platGbCd === "1" ? "2" : "1";

  return sigunguCd + bjdongCd + sanFlag + bun + ji;
}
