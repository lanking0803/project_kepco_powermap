/**
 * PNU 단위 KEPCO 용량 조회 — ParcelInfoPanel [전기] 탭 lazy fetch 출처.
 *
 * 호출 시점: 사용자가 [전기] 탭을 활성화한 시점 (모드 무관 — 전기/공매/견적 동일).
 * 캐시: PNU 단위 모듈 scope — 같은 패널에서 탭 재방문 시 재호출 X.
 *
 * Endpoint ↔ 함수 매핑:
 *   GET  /api/capa/by-pnu         ↔ fetchKepcoByPnu     (DB 조회, 빠름)
 *   POST /api/capa/refresh-by-pnu ↔ refreshKepcoByPnu   (KEPCO live + DB upsert)
 *
 * 분기 0 — 전기/공매 어느 모드에서 진입하든 PNU 만으로 동일 흐름.
 */

import type { AddrMeta, KepcoDataRow } from "@/lib/types";

/**
 * fallback 정보:
 *   used=false: exact 매칭 (rows 가 그 지번 정보 그대로)
 *   used=true:  exact 매칭 0건 → 같은 마을의 가까운 top 10 row 반환.
 *               UI 에서 "이 지번 정보 없음, 같은 마을 N건 표시" 안내.
 */
export type CapaFallback =
  | { used: false }
  | { used: true; target_jibun: string };

export interface CapaByPnuResult {
  rows: KepcoDataRow[];
  meta: AddrMeta | null;
  fallback: CapaFallback;
  /**
   * true = 같은 마을(bjd_code) 전체에 한전 데이터가 0건.
   * UI 에서 "이 마을 자체에 한전 정보가 없어 주변 지번도 표시 못 함" 멘트 분기용.
   * exact 매칭 성공 케이스는 항상 false.
   */
  villageEmpty: boolean;
}

interface CapaByPnuApiResponse {
  ok: boolean;
  pnu?: string;
  bjd_code?: string;
  jibun?: string;
  rows?: KepcoDataRow[];
  total?: number;
  meta?: AddrMeta | null;
  fallback?: CapaFallback;
  village_empty?: boolean;
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

const EMPTY_RESULT: CapaByPnuResult = {
  rows: [],
  meta: null,
  fallback: { used: false },
  villageEmpty: false,
};

/**
 * GET /api/capa/by-pnu — DB 단위 조회. 같은 PNU 재호출은 모듈 캐시 hit.
 * @param pnu 행안부 표준 PNU 19자리 (산구분 1=일반/2=산)
 * @returns 지번 단위로 매칭된 capa rows + 행정구역 메타. 형식 오류면 빈 결과.
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
      fallback: data.fallback ?? { used: false },
      villageEmpty: data.village_empty ?? false,
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
 * 호출 후 모듈 캐시를 비우고 새 결과로 채움 → 이후 fetchKepcoByPnu 즉시 hit.
 *
 * @returns 갱신된 capa rows. KEPCO 미보유 지번이면 빈 배열 + source='not_found'.
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

  // 갱신 결과를 모듈 캐시에 반영 (다음 fetchKepcoByPnu 즉시 hit).
  // refresh 응답엔 meta/fallback 이 없으므로 기존 meta 유지 또는 null.
  // refresh 는 KEPCO live 호출이라 fallback 의미 없음 → used=false 로 초기화.
  // villageEmpty 도 KEPCO live 결과 기준으로는 의미 없음 → false 로 초기화.
  const prev = resultCache.get(pnu);
  resultCache.set(pnu, {
    rows: data.rows ?? [],
    meta: prev?.meta ?? null,
    fallback: { used: false },
    villageEmpty: false,
  });

  return {
    rows: data.rows ?? [],
    source: data.source ?? "live",
    fetched_at: data.fetched_at,
  };
}

/** 모듈 캐시만 비움 (다음 fetchKepcoByPnu 가 서버 재요청). */
export function clearKepcoByPnuCache(): void {
  resultCache.clear();
  inflight.clear();
}
