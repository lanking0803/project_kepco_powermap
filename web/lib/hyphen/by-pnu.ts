/**
 * PNU 단위 경매 매물 조회 — ParcelInfoPanel [경매] 탭 lazy fetch 출처.
 *
 * 호출 시점: 사용자가 경매 탭을 클릭할 때.
 * 캐시: PNU 단위 모듈 scope. 30분 TTL (의뢰자 결정 2026-05-02 — 경매 매물 변동 빈도 고려).
 *
 * 백엔드: /api/auction/by-pnu (atomic endpoint).
 *   내부에서 진행물건검색 페이지 sweep + bjd_master 역조회 + PNU 매칭 + fallback.
 *
 * 캐시 정책:
 *   - PNU 단위 캐시 (resultCache): 같은 PNU 재방문 시 호출 0.
 *   - inflight: Strict Mode 이중 호출 / 사용자 연타 시 같은 fetch 공유.
 *   - TTL: 30분. 만료된 캐시는 자동 재호출.
 */

import type {
  AuctionListItem,
  HyphenApiStatus,
} from "./types";

/** 30분 TTL (ms). 의뢰자 결정. */
const CACHE_TTL_MS = 30 * 60 * 1000;

/** by-pnu 응답 fallback 필드 — 캠코 패턴 미러. */
export type AuctionByPnuFallback =
  | { used: false }
  | { used: true; target_jibun: string; villageItems: AuctionListItem[] };

/** by-pnu 캐시/반환 형태. apiStatus 추가 — UI 가 결제필요/만료 등 분기. */
export interface AuctionByPnuResult {
  apiStatus: HyphenApiStatus;
  errCd: string;
  errMsg: string;
  items: AuctionListItem[];
  fallback: AuctionByPnuFallback;
  villageEmpty: boolean;
  /** 면 매물 200건 cap 으로 잘렸으면 true */
  truncated: boolean;
  /** 응답 시각 (ms) — TTL 판정용 */
  fetchedAt: number;
}

const resultCache = new Map<string, AuctionByPnuResult>();
const inflight = new Map<string, Promise<AuctionByPnuResult>>();

function isFresh(r: AuctionByPnuResult): boolean {
  return Date.now() - r.fetchedAt < CACHE_TTL_MS;
}

/** 같은 PNU 의 매물 조회. 정상/fallback/empty/apiStatus 결과를 한 객체로 반환. */
export async function fetchAuctionByPnu(
  pnu: string,
): Promise<AuctionByPnuResult> {
  if (!/^\d{19}$/.test(pnu)) {
    return {
      apiStatus: "ok",
      errCd: "",
      errMsg: "",
      items: [],
      fallback: { used: false },
      villageEmpty: false,
      truncated: false,
      fetchedAt: Date.now(),
    };
  }

  // 캐시 hit + 신선
  const cached = resultCache.get(pnu);
  if (cached && isFresh(cached)) return cached;
  // 만료됐으면 한 번 비움 (다시 받기)
  if (cached && !isFresh(cached)) resultCache.delete(pnu);

  const pending = inflight.get(pnu);
  if (pending) return pending;

  const promise = (async () => {
    const res = await fetch(
      `/api/auction/by-pnu?pnu=${encodeURIComponent(pnu)}`,
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error(`/api/auction/by-pnu HTTP ${res.status}`);
    const json = (await res.json()) as
      | {
          ok: true;
          apiStatus: HyphenApiStatus;
          errCd: string;
          errMsg: string;
          items: AuctionListItem[];
          fallback?: AuctionByPnuFallback;
          village_empty?: boolean;
          truncated?: boolean;
        }
      | { ok: false; error: string };
    if (!json.ok) throw new Error(json.error);
    const result: AuctionByPnuResult = {
      apiStatus: json.apiStatus,
      errCd: json.errCd,
      errMsg: json.errMsg,
      items: json.items ?? [],
      fallback: json.fallback ?? { used: false },
      villageEmpty: json.village_empty ?? false,
      truncated: json.truncated ?? false,
      fetchedAt: Date.now(),
    };
    resultCache.set(pnu, result);
    return result;
  })().finally(() => {
    inflight.delete(pnu);
  });

  inflight.set(pnu, promise);
  return promise;
}

/** 모든 캐시 비우기 (테스트/refresh 용). */
export function clearAuctionByPnuCache(): void {
  resultCache.clear();
  inflight.clear();
}
