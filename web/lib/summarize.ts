/**
 * 마을(geocode_address) 단위 raw 데이터를 시설별로 집계
 */
import type { KepcoDataRow } from "./types";
import { hasCapacity } from "./types";

export interface FacilityStat {
  name: string;
  count: number;
  hasCapacity: boolean;
  baseCapacity: number;     // 기준 용량 (kW)
  receivedCapacity: number; // 접수 (kW)
  plannedCapacity: number;  // 계획 (kW)
  remaining: number;        // 잔여 (양수: 여유, 음수: 초과)
  step1?: { cnt: number; pwr: number };
  step2?: { cnt: number; pwr: number };
  step3?: { cnt: number; pwr: number };
}

/** 시설 종류별 행 단위 여유/부족 카운트 */
export interface FacilityCounts {
  total: number;
  okCount: number;     // 여유 있음 행 수
  noCount: number;     // 여유 없음 행 수
  okPct: number;       // 0~100
  noPct: number;       // 0~100
}

export interface LocationSummary {
  total: number;
  substations: FacilityStat[];
  transformers: FacilityStat[];
  distributionLines: FacilityStat[];
  /** 행 단위 여유/부족 카운트 (시설명 집계와 별개로 직접 계산) */
  substCounts: FacilityCounts;
  mtrCounts: FacilityCounts;
  dlCounts: FacilityCounts;
  hasStepData: boolean;
}

interface AggKeys {
  nameKey: keyof KepcoDataRow;
  capaKey: keyof KepcoDataRow;
  pwrKey: keyof KepcoDataRow;
  gCapaKey: keyof KepcoDataRow;
  prefix?: string;
}

interface AggregateResult {
  stats: FacilityStat[];
  hasStep: boolean;
}

function aggregate(items: KepcoDataRow[], k: AggKeys): AggregateResult {
  const map = new Map<string, FacilityStat>();
  let hasStep = false;

  items.forEach((it) => {
    const raw = it[k.nameKey] as string | null;
    if (!raw) return;
    const name = (k.prefix ?? "") + raw;

    let entry = map.get(name);
    if (!entry) {
      entry = {
        name,
        count: 0,
        hasCapacity: hasCapacity(
          Number(it[k.capaKey] ?? 0),
          Number(it[k.pwrKey] ?? 0),
          Number(it[k.gCapaKey] ?? 0),
        ),
        baseCapacity: Number(it[k.capaKey] ?? 0),
        receivedCapacity: Number(it[k.pwrKey] ?? 0),
        plannedCapacity: Number(it[k.gCapaKey] ?? 0),
        remaining: 0,
      };
      entry.remaining = entry.baseCapacity - entry.receivedCapacity;
      map.set(name, entry);
    }
    entry.count++;

    if (it.step1_cnt != null || it.step1_pwr != null) {
      hasStep = true;
      if (!entry.step1) {
        entry.step1 = { cnt: Number(it.step1_cnt ?? 0), pwr: Number(it.step1_pwr ?? 0) };
        entry.step2 = { cnt: Number(it.step2_cnt ?? 0), pwr: Number(it.step2_pwr ?? 0) };
        entry.step3 = { cnt: Number(it.step3_cnt ?? 0), pwr: Number(it.step3_pwr ?? 0) };
      }
    }
  });

  const stats = Array.from(map.values()).sort((a, b) => b.count - a.count);
  return { stats, hasStep };
}

export function summarizeLocation(items: KepcoDataRow[]): LocationSummary {
  const total = items.length;
  const substAgg = aggregate(items, {
    nameKey: "subst_nm",
    capaKey: "subst_capa",
    pwrKey: "subst_pwr",
    gCapaKey: "g_subst_capa",
  });
  const mtrAgg = aggregate(items, {
    nameKey: "mtr_no",
    capaKey: "mtr_capa",
    pwrKey: "mtr_pwr",
    gCapaKey: "g_mtr_capa",
    prefix: "#",
  });
  const dlAgg = aggregate(items, {
    nameKey: "dl_nm",
    capaKey: "dl_capa",
    pwrKey: "dl_pwr",
    gCapaKey: "g_dl_capa",
  });

  /**
   * 행 단위 카운트 — 각 row의 vol_xxx 컬럼을 직접 세서 정확하게 집계.
   * (시설명 집계는 첫 행의 상태만 저장하는 한계가 있어 별도로 계산)
   */
  const countsFor = (
    capaKey: keyof KepcoDataRow,
    pwrKey: keyof KepcoDataRow,
    gCapaKey: keyof KepcoDataRow,
  ): FacilityCounts => {
    let okCount = 0;
    for (const it of items) {
      if (hasCapacity(
        Number(it[capaKey] ?? 0),
        Number(it[pwrKey] ?? 0),
        Number(it[gCapaKey] ?? 0),
      )) okCount++;
    }
    const noCount = total - okCount;
    return {
      total,
      okCount,
      noCount,
      okPct: total > 0 ? Math.round((okCount / total) * 100) : 0,
      noPct: total > 0 ? Math.round((noCount / total) * 100) : 0,
    };
  };

  const hasStepData = substAgg.hasStep || mtrAgg.hasStep || dlAgg.hasStep;

  return {
    total,
    substations: substAgg.stats,
    transformers: mtrAgg.stats,
    distributionLines: dlAgg.stats,
    substCounts: countsFor("subst_capa", "subst_pwr", "g_subst_capa"),
    mtrCounts: countsFor("mtr_capa", "mtr_pwr", "g_mtr_capa"),
    dlCounts: countsFor("dl_capa", "dl_pwr", "g_dl_capa"),
    hasStepData,
  };
}

/** kW → 1000 이상이면 MW로 */
export function formatPower(kw: number): string {
  const abs = Math.abs(kw);
  if (abs >= 1000) return `${(kw / 1000).toFixed(2)} MW`;
  return `${kw.toLocaleString()} kW`;
}

/**
 * 잔여 용량 표기 — 부호 포함 + 자동 단위 변환.
 * 양수는 여유, 음수는 초과/부족.
 *   450    → "+450 kW"
 *   -2300  → "-2.30 MW"
 *   0      → "0 kW"
 */
export function formatRemaining(kw: number | null | undefined): string {
  if (kw == null || !Number.isFinite(kw)) return "-";
  if (kw === 0) return "0 kW";
  const abs = Math.abs(kw);
  const sign = kw > 0 ? "+" : "−"; // 유니코드 마이너스(−) — 하이픈보다 시각적으로 명확
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(2)} MW`;
  return `${sign}${abs.toLocaleString()} kW`;
}
