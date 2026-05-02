/**
 * 토지·상업업무용 실거래가 통계 헬퍼 — 영업담당자 시점의 의사결정 지표.
 *
 * UI(PriceTab) 가 직접 계산하지 않고 이 모듈만 import.
 * 통계 정의 변경(중앙값 vs 평균, 추세 산정 기간 등) 시 이 파일만 수정.
 *
 * 모든 함수는 0건/부분 데이터에서도 안전 (null 또는 0 반환).
 *
 * 토지(`computeLandStats`) — 카테고리 = 지목(전/답/임/대)
 * 건물(`computeNrgStats`) — 카테고리 = buildingUse(업무/근린생활/판매/숙박)
 */

import type { LandTransaction } from "./land-trade";
import { recentYearMonths } from "./land-trade";
import type { NrgTransaction } from "./nrg-trade";

export type TrendDirection = "up" | "down" | "flat";

export interface TradeStats {
  /** 전체 거래 건수 */
  total: number;
  /** 전체 평당가 중앙값 (원/평). 0건 시 null */
  medianPricePerPyeong: number | null;
  /**
   * 추세 — 후반 절반 vs 전반 절반 평당가 변화율.
   * 양쪽 모두 거래 있을 때만 계산. 부족하면 null.
   */
  trend: { pct: number; direction: TrendDirection } | null;
  /** YoY — 마지막 1개월 vs 12개월 전 1개월 평당가 중앙값 변화율. 양쪽 데이터 부족 시 null */
  yoy: { pct: number; direction: TrendDirection } | null;
  /** 평당가 최저/최고 (원/평) — 협상 룸 표시용. 0건 시 null */
  priceMin: number | null;
  priceMax: number | null;
  /** 카테고리별 집계 (count 내림차순) — 토지=지목 / 건물=용도 */
  byCategory: CategoryStats[];
  /** 월별 통계 (차트용, 과거 → 최신 정렬). 건수 + 평당가 중앙값 + IQR. */
  monthly: MonthlyStat[];
}

export interface CategoryStats {
  category: string;
  count: number;
  medianPricePerPyeong: number;
}

export interface MonthlyStat {
  /** "YYYY-MM" */
  ym: string;
  /** 그 달 거래 건수 */
  count: number;
  /** 그 달 평당가 중앙값 (원/평). 0건 시 null */
  median: number | null;
  /** 1사분위 (원/평). 1건 이하 시 null (IQR 의미 없음) */
  q1: number | null;
  /** 3사분위 (원/평). 1건 이하 시 null */
  q3: number | null;
}

interface BaseTradeRow {
  dealYmd: string;
  pricePerPyeong: number;
}

/** 토지 거래 → 영업담당자 통계 (지목별) */
export function computeLandStats(
  rows: LandTransaction[],
  months: number,
): TradeStats {
  return computeStatsImpl(rows, months, (r) => r.jimok || "(미상)");
}

/** 상업·업무용 거래 → 영업담당자 통계 (buildingUse 별) */
export function computeNrgStats(
  rows: NrgTransaction[],
  months: number,
): TradeStats {
  return computeStatsImpl(rows, months, (r) => r.buildingUse || "(미상)");
}

function computeStatsImpl<T extends BaseTradeRow>(
  rows: T[],
  months: number,
  categoryOf: (row: T) => string,
): TradeStats {
  const total = rows.length;

  if (total === 0) {
    return {
      total: 0,
      medianPricePerPyeong: null,
      trend: null,
      yoy: null,
      priceMin: null,
      priceMax: null,
      byCategory: [],
      monthly: emptyMonthly(months),
    };
  }

  const prices = rows.map((r) => r.pricePerPyeong);
  const medianPricePerPyeong = median(prices);
  const trend = computeTrend(rows, months);
  const yoy = computeYoy(rows, months);
  const byCategory = computeByCategory(rows, categoryOf);
  const monthly = computeMonthly(rows, months);

  return {
    total,
    medianPricePerPyeong,
    trend,
    yoy,
    priceMin: Math.min(...prices),
    priceMax: Math.max(...prices),
    byCategory,
    monthly,
  };
}

/**
 * YoY (전년 동기 대비) — 마지막 달 vs 12개월 전 달 평당가 중앙값.
 * 양쪽 모두 거래 있을 때만 계산. months < 13 이면 의미 없어서 null.
 */
function computeYoy<T extends BaseTradeRow>(
  rows: T[],
  months: number,
): TradeStats["yoy"] {
  if (months < 13) return null;
  const yms = recentYearMonths(months);
  if (yms.length < 13) return null;
  // recentYearMonths 는 최신 → 과거 정렬
  const latestYm = `${yms[0].slice(0, 4)}-${yms[0].slice(4, 6)}`;
  const yearAgoYm = `${yms[12].slice(0, 4)}-${yms[12].slice(4, 6)}`;
  const latestRows = rows.filter((r) => r.dealYmd === latestYm);
  const yearAgoRows = rows.filter((r) => r.dealYmd === yearAgoYm);
  if (latestRows.length === 0 || yearAgoRows.length === 0) return null;

  const latestMed = median(latestRows.map((r) => r.pricePerPyeong));
  const yearAgoMed = median(yearAgoRows.map((r) => r.pricePerPyeong));
  if (yearAgoMed <= 0) return null;

  const pct = ((latestMed - yearAgoMed) / yearAgoMed) * 100;
  const rounded = Math.round(pct * 10) / 10;
  const direction: TrendDirection =
    rounded > 1 ? "up" : rounded < -1 ? "down" : "flat";
  return { pct: rounded, direction };
}

/**
 * 후반 절반(최근) vs 전반 절반 평당가 중앙값 비교.
 * - 양쪽 모두 거래 1건 이상 필요
 * - ±1% 미만 = flat (의미 있는 변화로 보지 않음)
 */
function computeTrend<T extends BaseTradeRow>(
  rows: T[],
  months: number,
): TradeStats["trend"] {
  const half = Math.max(1, Math.floor(months / 2));
  const yms = recentYearMonths(months);
  const recentSet = new Set(
    yms.slice(0, half).map((ym) => `${ym.slice(0, 4)}-${ym.slice(4, 6)}`),
  );

  const recent = rows.filter((r) => recentSet.has(r.dealYmd));
  const older = rows.filter((r) => !recentSet.has(r.dealYmd));
  if (recent.length === 0 || older.length === 0) return null;

  const recentMed = median(recent.map((r) => r.pricePerPyeong));
  const olderMed = median(older.map((r) => r.pricePerPyeong));
  if (olderMed <= 0) return null;

  const pct = ((recentMed - olderMed) / olderMed) * 100;
  const rounded = Math.round(pct * 10) / 10;
  const direction: TrendDirection =
    rounded > 1 ? "up" : rounded < -1 ? "down" : "flat";
  return { pct: rounded, direction };
}

function computeByCategory<T extends BaseTradeRow>(
  rows: T[],
  categoryOf: (row: T) => string,
): CategoryStats[] {
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const key = categoryOf(r);
    const list = map.get(key);
    if (list) list.push(r.pricePerPyeong);
    else map.set(key, [r.pricePerPyeong]);
  }
  return Array.from(map.entries())
    .map(([category, prices]) => ({
      category,
      count: prices.length,
      medianPricePerPyeong: median(prices),
    }))
    .sort((a, b) => b.count - a.count);
}

function computeMonthly<T extends BaseTradeRow>(
  rows: T[],
  months: number,
): MonthlyStat[] {
  const yms = recentYearMonths(months);
  const buckets = new Map<string, number[]>();
  for (const ym of yms) {
    buckets.set(`${ym.slice(0, 4)}-${ym.slice(4, 6)}`, []);
  }
  for (const r of rows) {
    const list = buckets.get(r.dealYmd);
    if (list) list.push(r.pricePerPyeong);
  }
  return Array.from(buckets.entries())
    .map(([ym, prices]) => {
      const count = prices.length;
      if (count === 0) {
        return { ym, count, median: null, q1: null, q3: null };
      }
      const sorted = [...prices].sort((a, b) => a - b);
      const med = median(sorted);
      // IQR 은 2건 이상일 때만 의미. 1건이면 분포 없음.
      const { q1, q3 } = count >= 2 ? quartiles(sorted) : { q1: null, q3: null };
      return { ym, count, median: med, q1, q3 };
    })
    .sort((a, b) => a.ym.localeCompare(b.ym));
}

function emptyMonthly(months: number): MonthlyStat[] {
  return recentYearMonths(months)
    .map((ym) => ({
      ym: `${ym.slice(0, 4)}-${ym.slice(4, 6)}`,
      count: 0,
      median: null,
      q1: null,
      q3: null,
    }))
    .sort((a, b) => a.ym.localeCompare(b.ym));
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/**
 * 사분위수 (linear interpolation) — 정렬된 배열 입력 가정.
 * 토지/건물 거래는 outlier 영향이 커서 표준편차 대신 IQR 사용 (의뢰자 결정).
 */
function quartiles(sorted: number[]): { q1: number; q3: number } {
  return { q1: percentile(sorted, 0.25), q3: percentile(sorted, 0.75) };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return Math.round(sorted[lo] * (1 - frac) + sorted[hi] * frac);
}

/**
 * 유사 면적 (±50%) 거래만 골라 평당가 중앙값.
 * 영업담당자 핵심 지표 — "내 필지와 비슷한 면적의 토지가 평당 얼마에 거래됐는가".
 *
 * 클라이언트에서 필터된 rows + 클릭 필지 면적을 받아 즉시 계산.
 * 매칭 0건이면 null.
 */
export function computeSimilarAreaMedian(
  rows: ReadonlyArray<{ pricePerPyeong: number; area_m2: number }>,
  clickedArea_m2: number,
): number | null {
  if (clickedArea_m2 <= 0) return null;
  const lo = clickedArea_m2 * 0.5;
  const hi = clickedArea_m2 * 1.5;
  const filtered = rows.filter((r) => r.area_m2 >= lo && r.area_m2 <= hi);
  if (filtered.length === 0) return null;
  return median(filtered.map((r) => r.pricePerPyeong));
}
