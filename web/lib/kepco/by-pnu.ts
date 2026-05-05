/**
 * PNU 단위 KEPCO 용량 조회 — ParcelInfoPanel [전기] 탭 lazy fetch 출처.
 *
 * 호출 시점: 사용자가 [전기] 탭을 활성화한 시점 (모드 무관 — 전기/공매/견적 동일).
 * 캐시: PNU 단위 모듈 scope — 같은 패널에서 탭 재방문 시 재호출 X.
 *
 * Endpoint ↔ 함수 매핑:
 *   GET  /api/capa/by-pnu          ↔ fetchKepcoByPnu       (같은 마을 top N, 자기 포함)
 *   POST /api/capa/refresh-by-pnu  ↔ refreshKepcoByPnu     (KEPCO live + DB upsert)
 *
 * UI 가 응답 rows 에서 buildPnuFromBjdAndJibun 으로 자기/주변 분기.
 */

import type { AddrMeta, KepcoDataRow } from "@/lib/types";

export interface CapaByPnuResult {
  rows: KepcoDataRow[];
  meta: AddrMeta | null;
}

interface CapaByPnuApiResponse {
  ok: boolean;
  pnu?: string;
  bjd_code?: string;
  jibun?: string;
  rows?: KepcoDataRow[];
  total?: number;
  meta?: AddrMeta | null;
  error?: string;
}

interface RefreshApiResponse {
  ok: boolean;
  source?: "live" | "not_found" | string;
  bjd_code?: string | null;
  addr_jibun?: string;
  rows?: KepcoDataRow[];
  fetched_at?: string;
  error?: string;
}

const resultCache = new Map<string, CapaByPnuResult>();
const inflight = new Map<string, Promise<CapaByPnuResult>>();

const EMPTY_RESULT: CapaByPnuResult = { rows: [], meta: null };

/**
 * GET /api/capa/by-pnu — 같은 마을 가까운 지번 top N (자기 포함).
 * 같은 PNU 재호출은 모듈 캐시 hit.
 */
export async function fetchKepcoByPnu(
  pnu: string,
  options?: { signal?: AbortSignal },
): Promise<CapaByPnuResult> {
  if (!/^\d{19}$/.test(pnu)) return EMPTY_RESULT;

  const cached = resultCache.get(pnu);
  if (cached) return cached;

  const pending = inflight.get(pnu);
  if (pending) return pending;

  const promise = (async () => {
    const res = await fetch(`/api/capa/by-pnu?pnu=${encodeURIComponent(pnu)}`, {
      signal: options?.signal,
    });
    const data = (await res.json()) as CapaByPnuApiResponse;
    if (!data.ok) throw new Error(data.error || "PNU 용량 조회 실패");
    const result: CapaByPnuResult = {
      rows: data.rows ?? [],
      meta: data.meta ?? null,
    };
    resultCache.set(pnu, result);
    return result;
  })().finally(() => {
    inflight.delete(pnu);
  });

  inflight.set(pnu, promise);
  return promise;
}

/**
 * POST /api/capa/refresh-by-pnu — KEPCO live 호출 + DB upsert (강제 갱신).
 * 호출 후 모듈 캐시를 비움 → 다음 fetchKepcoByPnu 가 갱신된 같은 마을 결과 받음.
 *
 * @returns 갱신된 capa rows (해당 지번만). KEPCO 미보유 지번이면 빈 배열 + source='not_found'.
 */
export async function refreshKepcoByPnu(pnu: string): Promise<{
  rows: KepcoDataRow[];
  source: string;
  fetched_at?: string;
}> {
  if (!/^\d{19}$/.test(pnu)) {
    return { rows: [], source: "invalid_pnu" };
  }

  const res = await fetch("/api/capa/refresh-by-pnu", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pnu }),
  });
  const data = (await res.json()) as RefreshApiResponse;
  if (!data.ok) throw new Error(data.error || "PNU 용량 갱신 실패");

  // 모듈 캐시 invalidate — 다음 fetchKepcoByPnu 가 같은 마을 top N 을 새로 받아옴.
  // (refresh 응답은 자기 지번만이라 캐시에 직접 넣으면 주변 지번이 사라짐.)
  resultCache.delete(pnu);
  inflight.delete(pnu);

  return {
    rows: data.rows ?? [],
    source: data.source ?? "live",
    fetched_at: data.fetched_at,
  };
}

/** 모듈 캐시 비움 (다음 fetchKepcoByPnu 가 서버 재요청). */
export function clearKepcoByPnuCache(pnu?: string): void {
  if (pnu) {
    resultCache.delete(pnu);
    inflight.delete(pnu);
  } else {
    resultCache.clear();
    inflight.clear();
  }
}

/**
 * GET /api/capa/jibun-list-by-pnu — KEPCO 가 마을에 보유한 지번 텍스트 배열.
 * 메모리/UI 일회성 — 캐시 없음 (사용자가 누를 때마다 KEPCO live).
 */
export async function fetchKepcoJibunListByPnu(
  pnu: string,
  options?: { signal?: AbortSignal },
): Promise<string[]> {
  if (!/^\d{19}$/.test(pnu)) return [];
  const res = await fetch(
    `/api/capa/jibun-list-by-pnu?pnu=${encodeURIComponent(pnu)}`,
    { signal: options?.signal },
  );
  const data = (await res.json()) as {
    ok: boolean;
    jibuns?: string[];
    error?: string;
  };
  if (!data.ok) throw new Error(data.error || "지번 목록 조회 실패");
  return data.jibuns ?? [];
}
