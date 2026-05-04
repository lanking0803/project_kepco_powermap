/**
 * 원 단위 금액을 보기 좋게 포맷.
 *
 * 정책 (의뢰자 결정 2026-05-04):
 *   - 1억 이상: 소수점 1자리 억 단위 (예: 5.3억, 15.6억) — 정수면 ".0" 생략 (1억)
 *   - 1만 이상: 만 단위 정수 (예: 53,174만)
 *   - 그 외: 원 (예: 1,200원)
 *
 * 목록 카드/상세 모달 모두 동일 표기 사용 — UI 전체 통일.
 */
export function formatWon(won: number): string {
  if (won >= 100_000_000) {
    const eok = won / 100_000_000;
    const rounded = Math.round(eok * 10) / 10;
    return Number.isInteger(rounded)
      ? `${rounded.toLocaleString()}억`
      : `${rounded.toFixed(1)}억`;
  }
  if (won >= 10_000) return `${Math.round(won / 10_000).toLocaleString()}만`;
  return `${won.toLocaleString()}원`;
}
