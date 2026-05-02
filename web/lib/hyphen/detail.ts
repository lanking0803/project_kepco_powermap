/**
 * 경매 매물 단건 상세 조회 (lazy) — productId 단위 모듈 캐시.
 *
 * 사용처:
 *   - AuctionTab 매물 카드의 "상세 펼치기" 버튼 클릭 시 호출.
 *   - 같은 productId 재방문 시 호출 0 (메모리 캐시).
 *
 * 신선도: 30분 TTL — by-pnu 와 동일 정책.
 */

import type { AuctionRawDetailItem, HyphenApiStatus } from "./types";

const CACHE_TTL_MS = 30 * 60 * 1000;

export interface AuctionDetailFetchResult {
  apiStatus: HyphenApiStatus;
  errCd: string;
  errMsg: string;
  detail: AuctionRawDetailItem | null;
  fetchedAt: number;
}

const resultCache = new Map<string, AuctionDetailFetchResult>();
const inflight = new Map<string, Promise<AuctionDetailFetchResult>>();

function isFresh(r: AuctionDetailFetchResult): boolean {
  return Date.now() - r.fetchedAt < CACHE_TTL_MS;
}

export async function fetchAuctionDetailLazy(
  productId: string | number,
): Promise<AuctionDetailFetchResult> {
  const key = String(productId);
  if (!/^\d+$/.test(key)) {
    return {
      apiStatus: "ok",
      errCd: "",
      errMsg: "",
      detail: null,
      fetchedAt: Date.now(),
    };
  }

  const cached = resultCache.get(key);
  if (cached && isFresh(cached)) return cached;
  if (cached && !isFresh(cached)) resultCache.delete(key);

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    const res = await fetch(
      `/api/auction/detail?productId=${encodeURIComponent(key)}`,
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error(`/api/auction/detail HTTP ${res.status}`);
    const json = (await res.json()) as
      | {
          ok: true;
          apiStatus: HyphenApiStatus;
          errCd: string;
          errMsg: string;
          detail: AuctionRawDetailItem | null;
        }
      | { ok: false; error: string };
    if (!json.ok) throw new Error(json.error);
    const result: AuctionDetailFetchResult = {
      apiStatus: json.apiStatus,
      errCd: json.errCd,
      errMsg: json.errMsg,
      detail: json.detail,
      fetchedAt: Date.now(),
    };
    resultCache.set(key, result);
    return result;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}

export function clearAuctionDetailCache(): void {
  resultCache.clear();
  inflight.clear();
}
