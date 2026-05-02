/**
 * PNU 단위 공매 매물 조회 — ParcelInfoPanel [공매] 탭 lazy fetch 출처.
 *
 * 호출 시점: 사용자가 공매 탭을 클릭할 때 (모드 무관).
 * 캐시: PNU 단위 모듈 scope — 같은 패널에서 탭 재방문 시 재호출 X.
 *
 * 백엔드: /api/onbid/by-pnu (atomic endpoint).
 *   내부에서 bjd_master JOIN → 캠코 목록 → ltnoPnu 필터 → 캠코 상세 병렬.
 *   exact 매칭 0건 시 같은 마을 매물 fallback (KEPCO 패턴 미러).
 */

import type { OnbidDetail, OnbidListItem } from "./types";

/** by-pnu 응답 fallback 필드 — KEPCO 패턴 미러. */
export type OnbidByPnuFallback =
  | { used: false }
  | { used: true; target_jibun: string; villageItems: OnbidListItem[] };

/** by-pnu 캐시/반환 형태 — 정상/fallback/empty 3가지 상태를 한 객체에 담음. */
export interface OnbidByPnuResult {
  items: OnbidDetail[];
  fallback: OnbidByPnuFallback;
  villageEmpty: boolean;
}

/**
 * 결과 캐시 (완료된 응답).
 * Promise 캐시 (진행 중인 요청) — Strict Mode 이중 호출/연타 시 같은 fetch 공유.
 */
const resultCache = new Map<string, OnbidByPnuResult>();
const inflight = new Map<string, Promise<OnbidByPnuResult>>();

/** 같은 PNU 의 매물 조회. 정상/fallback/empty 결과를 한 객체로 반환. */
export async function fetchOnbidByPnu(pnu: string): Promise<OnbidByPnuResult> {
  if (!/^\d{19}$/.test(pnu)) {
    return { items: [], fallback: { used: false }, villageEmpty: false };
  }

  const cached = resultCache.get(pnu);
  if (cached) return cached;

  const pending = inflight.get(pnu);
  if (pending) return pending;

  const promise = (async () => {
    const res = await fetch(
      `/api/onbid/by-pnu?pnu=${encodeURIComponent(pnu)}`,
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error(`/api/onbid/by-pnu HTTP ${res.status}`);
    const json = (await res.json()) as
      | {
          ok: true;
          items: OnbidDetail[];
          fallback?: OnbidByPnuFallback;
          village_empty?: boolean;
        }
      | { ok: false; error: string };
    if (!json.ok) throw new Error(json.error);
    const result: OnbidByPnuResult = {
      items: json.items ?? [],
      fallback: json.fallback ?? { used: false },
      villageEmpty: json.village_empty ?? false,
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
export function clearOnbidByPnuCache(): void {
  resultCache.clear();
  inflight.clear();
}
