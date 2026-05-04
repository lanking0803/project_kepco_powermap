/**
 * 법원경매 사건 상세 lazy fetch — 클라이언트 모듈 캐시.
 *
 * /api/auction/court-detail 호출 + (cortOfcCd, csNo) 단위 결과 캐시.
 * AuctionTab > CourtAuctionDetailCard 의 "상세 펼치기" 클릭 시 사용.
 *
 * 캐시 정책 (hyphen detail.ts 미러):
 *   - 30분 TTL
 *   - 같은 사건 재방문 시 호출 0
 *   - inflight 공유 — Strict Mode 이중 호출 방지
 */

import type { CourtApiStatus, CourtRawDetailItem } from "./types";

const CACHE_TTL_MS = 30 * 60 * 1000;

export interface CourtDetailFetchResult {
  apiStatus: CourtApiStatus;
  errMsg: string;
  detail: CourtRawDetailItem | null;
  fetchedAt: number;
}

const resultCache = new Map<string, CourtDetailFetchResult>();
const inflight = new Map<string, Promise<CourtDetailFetchResult>>();

function makeKey(cortOfcCd: string, csNo: string): string {
  return `${cortOfcCd}|${csNo}`;
}

function isFresh(r: CourtDetailFetchResult): boolean {
  return Date.now() - r.fetchedAt < CACHE_TTL_MS;
}

/**
 * 사건 상세 가져오기 — 캐시 우선 + inflight 공유.
 *
 * @param cortOfcCd 법원 코드 (예: "B000210")
 * @param csNo      사건번호 raw 14자리 (예: "20250130102682")
 */
export async function fetchCourtDetailLazy(
  cortOfcCd: string,
  csNo: string,
): Promise<CourtDetailFetchResult> {
  const key = makeKey(cortOfcCd, csNo);

  // 입력 검증 — 형식 어긋나면 null detail 즉시 반환
  if (!/^B\d{6}$/.test(cortOfcCd) || !/^\d{14}$/.test(csNo)) {
    return {
      apiStatus: "ok",
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
    const url = `/api/auction/court-detail?cortOfcCd=${encodeURIComponent(
      cortOfcCd,
    )}&csNo=${encodeURIComponent(csNo)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`/api/auction/court-detail HTTP ${res.status}`);
    const json = (await res.json()) as
      | {
          ok: true;
          apiStatus: CourtApiStatus;
          errMsg?: string;
          data: CourtRawDetailItem | null;
        }
      | { ok: false; error: string };
    if (!json.ok) throw new Error(json.error);
    const result: CourtDetailFetchResult = {
      apiStatus: json.apiStatus,
      errMsg: json.errMsg ?? "",
      detail: json.data,
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

export function clearCourtDetailCache(): void {
  resultCache.clear();
  inflight.clear();
}
