/**
 * PNU 단위 공매 매물 조회 — ParcelInfoPanel [공매] 탭 lazy fetch 출처.
 *
 * 호출 시점: 사용자가 공매 탭을 클릭할 때 (모드 무관).
 * 캐시: PNU 단위 모듈 scope — 같은 패널에서 탭 재방문 시 재호출 X.
 *
 * 백엔드: /api/onbid/by-pnu (atomic endpoint).
 *   내부에서 bjd_master JOIN → 캠코 목록 → ltnoPnu 필터 → 캠코 상세 병렬.
 */

import type { OnbidDetail } from "./types";

/**
 * 결과 캐시 (완료된 응답).
 * Promise 캐시 (진행 중인 요청) — Strict Mode 이중 호출/연타 시 같은 fetch 공유.
 */
const resultCache = new Map<string, OnbidDetail[]>();
const inflight = new Map<string, Promise<OnbidDetail[]>>();

/** 같은 PNU 의 매물 조회. 매물이 없으면 빈 배열. */
export async function fetchOnbidByPnu(pnu: string): Promise<OnbidDetail[]> {
  if (!/^\d{19}$/.test(pnu)) return [];

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
      | { ok: true; items: OnbidDetail[] }
      | { ok: false; error: string };
    if (!json.ok) throw new Error(json.error);
    const items = json.items ?? [];
    resultCache.set(pnu, items);
    return items;
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
