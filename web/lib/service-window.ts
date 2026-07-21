/**
 * 서비스 이용기간 판정
 *
 * 환경변수 `SERVICE_EXPIRES_AT` (YYYY-MM-DD) 로 만료일을 지정한다.
 * 지정한 날짜의 **한국시간(KST) 23:59:59 까지** 유효하며, 다음날 00:00 부터 만료.
 *
 * ⚠️ Vercel 런타임 시계는 UTC 다 (vercel.json 의 region=icn1 은 실행 위치일 뿐
 *    시스템 시계와 무관). `new Date()` 를 그대로 비교하면 만료가 9시간 밀리므로
 *    아래처럼 KST 오프셋을 명시적으로 더해서 판정한다.
 *
 * 값이 없거나 형식이 잘못되면 **정상 운영**으로 간주한다.
 * (환경변수 실수로 서비스가 멈추는 사고를 막기 위한 fail-open)
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** YYYY-MM-DD 형식만 허용 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 서비스 이용기간이 만료됐는지 판정.
 * @param now 판정 기준 시각 (테스트용 주입, 기본값 = 현재)
 */
export function isServiceExpired(now: Date = new Date()): boolean {
  const raw = process.env.SERVICE_EXPIRES_AT?.trim();

  // 미설정 → 정상 운영
  if (!raw) return false;

  // 형식 오류 → 정상 운영 (fail-open)
  if (!DATE_PATTERN.test(raw)) return false;

  // 만료일 다음날 KST 00:00 = UTC 기준 시각
  // 예: 2026-08-20 → 2026-08-21T00:00:00+09:00 → 2026-08-20T15:00:00Z
  const deadlineUtcMs = Date.parse(`${raw}T00:00:00Z`) + 24 * 60 * 60 * 1000 - KST_OFFSET_MS;

  // Date.parse 실패 → 정상 운영 (fail-open)
  if (Number.isNaN(deadlineUtcMs)) return false;

  return now.getTime() >= deadlineUtcMs;
}
