/**
 * 법원경매 특이사항 코드 (rletDspslSpcCondCd).
 *
 * 검증 (2026-05-04 의뢰자 캡처):
 *   - 법정지상권만 체크 → "0004301,"
 *   - 예고등기만 체크 → "0004308"
 *   → UI 순서와 코드 순서 1:1 일치 확인
 *
 * 호출 전송 형식: 콤마 join (예: "0004301,0004303,0004305")
 *   - trailing 콤마 허용 (서버가 둘 다 받음)
 *   - 빈 배열 = 빈 문자열 = 전체
 */

/** 특이사항 키 — 우리 코드 내부에서 식별. */
export type CourtSpecialCondKey =
  | "법정지상권"
  | "별도등기"
  | "유치권"
  | "분묘기지권"
  | "재매각"
  | "특별매각조건"
  | "농지취득"
  | "예고등기"
  | "선순위"
  | "우선매수신고";

/** 키 → 서버 코드. UI 표시 순서와 동일. */
export const COURT_SPECIAL_COND_CODE: Record<CourtSpecialCondKey, string> = {
  법정지상권: "0004301",
  별도등기: "0004302",
  유치권: "0004303",
  분묘기지권: "0004304",
  재매각: "0004305",
  특별매각조건: "0004306",
  농지취득: "0004307",
  예고등기: "0004308",
  선순위: "0004309",
  우선매수신고: "0004310",
};

/** UI 표시 순서. */
export const COURT_SPECIAL_COND_ORDER: CourtSpecialCondKey[] = [
  "법정지상권",
  "별도등기",
  "유치권",
  "분묘기지권",
  "재매각",
  "특별매각조건",
  "농지취득",
  "예고등기",
  "선순위",
  "우선매수신고",
];

/**
 * 키 배열 → 서버 전송용 콤마 join.
 *
 * 입력: ["법정지상권", "유치권"]
 * 출력: "0004301,0004303"
 *
 * 빈 배열 = "" (= 전체).
 */
export function buildSpecialCondParam(keys: CourtSpecialCondKey[]): string {
  if (keys.length === 0) return "";
  return keys
    .map((k) => COURT_SPECIAL_COND_CODE[k])
    .filter(Boolean)
    .join(",");
}
