/**
 * 경매 채널 — court (법원경매 직접) 또는 hyphen (백업).
 *
 * 환경변수:
 *   - 서버: AUCTION_CHANNEL (route.ts 가 사용)
 *   - 클라이언트: NEXT_PUBLIC_AUCTION_CHANNEL (UI 분기 사용)
 *
 * 둘은 같은 값이어야 함 (서버 호출 분기와 UI 카테고리 데이터 분기 일치).
 * 미설정 시 기본 = court (의뢰자 합의 2026-05-04).
 */

export type AuctionChannel = "court" | "hyphen";

/** 클라이언트(브라우저)에서 현재 채널 — UI 분기용. */
export function getClientAuctionChannel(): AuctionChannel {
  const v = process.env.NEXT_PUBLIC_AUCTION_CHANNEL;
  return v === "hyphen" ? "hyphen" : "court";
}
