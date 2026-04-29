/**
 * Client-side fetch wrapper — 실거래가 atomic endpoint (kind 분기).
 *
 * 컴포넌트는 이 파일의 함수만 호출 (vendor 추상화 — RTMS 모름).
 * 입력은 PNU 단일 (상세정보 팝업 모든 탭의 통일 정책).
 *
 * 캐시 + URL 정규화:
 *   - RTMS 는 LAWD_CD(시군구 5자리) 단위 응답이라 같은 시군구는 결과 동일.
 *   - 클라이언트 캐시 키 = 시군구 BJD (PNU 앞 5자리 + "00000") → 같은 시군구 내
 *     다른 PNU 도 cache hit (무료 시세 비교).
 *   - 서버도 PNU → 시군구 BJD 도출 후 동일 LAWD_CD 호출 → CDN 캐시 hit.
 *   - 0건 결과도 캐시 (재호출 방지).
 *
 * Endpoint ↔ 함수:
 *   /api/transactions/by-pnu?kind=land ↔ fetchLandTransactionsByPnu
 *   /api/transactions/by-pnu?kind=nrg  ↔ fetchNrgTransactionsByPnu
 */
import type { LandTransaction } from "@/lib/rtms/land-trade";
import type { NrgTransaction } from "@/lib/rtms/nrg-trade";
import type { TradeStats } from "@/lib/rtms/trade-stats";

export type TransactionKind = "land" | "nrg";

interface ApiResponseLand {
  ok: boolean;
  pnu?: string;
  sgg_bjd?: string;
  kind?: "land";
  months?: number;
  rows?: LandTransaction[];
  stats?: TradeStats;
  error?: string;
}

interface ApiResponseNrg {
  ok: boolean;
  pnu?: string;
  sgg_bjd?: string;
  kind?: "nrg";
  months?: number;
  rows?: NrgTransaction[];
  stats?: TradeStats;
  error?: string;
}

interface FetchOptions {
  signal?: AbortSignal;
}

export interface LandTransactionsResult {
  rows: LandTransaction[];
  stats: TradeStats;
  months: number;
}

export interface NrgTransactionsResult {
  rows: NrgTransaction[];
  stats: TradeStats;
  months: number;
}

const cache = new Map<string, LandTransactionsResult | NrgTransactionsResult>();

/** PNU 앞 5자리 + "00000" = 시군구 BJD (캐시 키 정규화). */
function pnuToSggBjd(pnu: string): string {
  return pnu.slice(0, 5) + "00000";
}

function key(pnu: string, months: number, kind: TransactionKind): string {
  return `${pnuToSggBjd(pnu)}:${months}:${kind}`;
}

async function fetchByKind(
  pnu: string,
  months: number,
  kind: TransactionKind,
  options?: FetchOptions,
): Promise<unknown> {
  const url = `/api/transactions/by-pnu?pnu=${encodeURIComponent(pnu)}&months=${months}&kind=${kind}`;
  const res = await fetch(url, { signal: options?.signal });
  return res.json();
}

/** /api/transactions/by-pnu?kind=land — PNU 입력 → 시군구 단위 토지 실거래가 + 통계. */
export async function fetchLandTransactionsByPnu(
  pnu: string,
  months: number = 12,
  options?: FetchOptions,
): Promise<LandTransactionsResult> {
  const k = key(pnu, months, "land");
  const cached = cache.get(k) as LandTransactionsResult | undefined;
  if (cached) return cached;

  const data = (await fetchByKind(
    pnu,
    months,
    "land",
    options,
  )) as ApiResponseLand;
  if (!data.ok) throw new Error(data.error || "토지 실거래가 조회 실패");
  const result: LandTransactionsResult = {
    rows: data.rows ?? [],
    stats: data.stats as TradeStats,
    months: data.months ?? months,
  };
  cache.set(k, result);
  return result;
}

/** /api/transactions/by-pnu?kind=nrg — PNU 입력 → 시군구 단위 상업·업무용 매매 + 통계. */
export async function fetchNrgTransactionsByPnu(
  pnu: string,
  months: number = 12,
  options?: FetchOptions,
): Promise<NrgTransactionsResult> {
  const k = key(pnu, months, "nrg");
  const cached = cache.get(k) as NrgTransactionsResult | undefined;
  if (cached) return cached;

  const data = (await fetchByKind(
    pnu,
    months,
    "nrg",
    options,
  )) as ApiResponseNrg;
  if (!data.ok) throw new Error(data.error || "상업업무용 실거래가 조회 실패");
  const result: NrgTransactionsResult = {
    rows: data.rows ?? [],
    stats: data.stats as TradeStats,
    months: data.months ?? months,
  };
  cache.set(k, result);
  return result;
}

export function clearTransactionsCache(): void {
  cache.clear();
}

export type { LandTransaction, NrgTransaction, TradeStats };
