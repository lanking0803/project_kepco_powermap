/**
 * Client-side fetch wrapper — 조례 atomic endpoint.
 *
 * Endpoint ↔ 함수:
 *   /api/regulations/by-pnu ↔ fetchRegulationsByPnu
 *
 * 캐시: 모듈 scope Map (페이지 라이프타임). 같은 PNU 재호출 0회 fetch.
 * 빈 응답도 캐시 (재호출 방지).
 */
import type { LawOrdinance } from "@/lib/regulations/law-api";
import type { SigKind } from "@/lib/regulations/region";

export interface RegulationsByPnuResult {
  pnu: string;
  region: { ctp_nm: string; sig_nm: string; sig_kind: SigKind } | null;
  /** 광역 자치단체 조례/규칙 — 예: "충청남도 도시계획 조례" */
  wide: LawOrdinance[];
  /** 기초 자치단체 조례/규칙 — 예: "부여군 군계획 조례". 단층 광역(세종/제주)은 항상 빈 배열 */
  local: LawOrdinance[];
}

interface RegulationsApiResponse {
  ok: boolean;
  pnu?: string;
  region?: RegulationsByPnuResult["region"];
  wide?: LawOrdinance[];
  local?: LawOrdinance[];
  error?: string;
}

interface FetchOptions {
  signal?: AbortSignal;
}

const cache = new Map<string, RegulationsByPnuResult>();

/** /api/regulations/by-pnu — PNU → 광역+기초 도시계획 조례. 캐시 키 = PNU. */
export async function fetchRegulationsByPnu(
  pnu: string,
  options?: FetchOptions,
): Promise<RegulationsByPnuResult> {
  const cached = cache.get(pnu);
  if (cached) return cached;

  const res = await fetch(
    `/api/regulations/by-pnu?pnu=${encodeURIComponent(pnu)}`,
    { signal: options?.signal },
  );
  const data = (await res.json()) as RegulationsApiResponse;
  if (!data.ok) throw new Error(data.error || "조례 조회 실패");
  const result: RegulationsByPnuResult = {
    pnu,
    region: data.region ?? null,
    wide: data.wide ?? [],
    local: data.local ?? [],
  };
  cache.set(pnu, result);
  return result;
}

export type { LawOrdinance };
