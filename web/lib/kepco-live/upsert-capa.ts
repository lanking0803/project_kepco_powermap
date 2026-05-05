/**
 * KEPCO 응답 → kepco_capa UPSERT.
 *
 * crawler/crawl_to_db.py 의 _to_capa_row + upsert 룰을 TS 로 포팅:
 *   - 빈 문자열 → NULL (UNIQUE 정합성)
 *   - 숫자 필드: 콤마 제거 + int 변환, 파싱 실패 시 NULL
 *   - UPSERT 키: (bjd_code, addr_jibun, subst_nm, mtr_no, dl_nm)
 *   - updated_at: DB DEFAULT NOW() — upsert 시 자동 갱신
 *
 * STEP 보존 (step1~step3): toCapaRow 가 step 컬럼을 채우지 않으므로
 * UPSERT body 에도 step 키가 없다 → PostgREST 가 ON CONFLICT DO UPDATE SET 시
 * step 컬럼은 건드리지 않아 기존값 자동 보존 (대량 크롤러 값 유지).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { KepcoCapacityRow } from "./kepco-client";

export interface CapaRowInput {
  bjd_code: string;
  addr_jibun: string | null;
  subst_nm: string | null;
  mtr_no: string | null;
  dl_nm: string | null;
  subst_capa: number | null;
  subst_pwr: number | null;
  g_subst_capa: number | null;
  mtr_capa: number | null;
  mtr_pwr: number | null;
  g_mtr_capa: number | null;
  dl_capa: number | null;
  dl_pwr: number | null;
  g_dl_capa: number | null;
}

export interface UpsertResult {
  upserted: number;
}

export function parseIntSafe(v: number | string | undefined | null): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : null;
  const s = String(v).replace(/,/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function emptyToNull(v: string | undefined | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** KEPCO 응답 row → kepco_capa 컬럼 형태로 변환. */
export function toCapaRow(
  bjd_code: string,
  addr_jibun: string,
  kepco: KepcoCapacityRow,
): CapaRowInput {
  return {
    bjd_code,
    addr_jibun: emptyToNull(addr_jibun),
    subst_nm: emptyToNull(kepco.SUBST_NM),
    mtr_no: emptyToNull(String(kepco.MTR_NO ?? "")),
    dl_nm: emptyToNull(kepco.DL_NM),
    subst_capa: parseIntSafe(kepco.SUBST_CAPA),
    subst_pwr: parseIntSafe(kepco.SUBST_PWR),
    g_subst_capa: parseIntSafe(kepco.G_SUBST_CAPA),
    mtr_capa: parseIntSafe(kepco.MTR_CAPA),
    mtr_pwr: parseIntSafe(kepco.MTR_PWR),
    g_mtr_capa: parseIntSafe(kepco.G_MTR_CAPA),
    dl_capa: parseIntSafe(kepco.DL_CAPA),
    dl_pwr: parseIntSafe(kepco.DL_PWR),
    g_dl_capa: parseIntSafe(kepco.G_DL_CAPA),
  };
}

export async function upsertKepcoCapa(
  bjd_code: string,
  addr_jibun: string,
  kepcoRows: KepcoCapacityRow[],
): Promise<UpsertResult> {
  if (kepcoRows.length === 0) return { upserted: 0 };

  // KEPCO 가 같은 시설 조합 (변전소/주변압기/배전선로) 을 한 응답에 중복 반환하는
  // 케이스가 있음 (예: 세종 도암리 58 — '58' 같은 사례). UNIQUE 제약 키로 dedupe
  // 후 마지막 값을 채택 — 같은 키면 어차피 capa 숫자도 같다.
  const rows = kepcoRows.map((r) => toCapaRow(bjd_code, addr_jibun, r));
  const dedup = new Map<string, CapaRowInput>();
  for (const r of rows) {
    const k = `${r.bjd_code}|${r.addr_jibun ?? ""}|${r.subst_nm ?? ""}|${r.mtr_no ?? ""}|${r.dl_nm ?? ""}`;
    dedup.set(k, r);
  }
  const unique = Array.from(dedup.values());

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("kepco_capa")
    .upsert(unique, {
      onConflict: "bjd_code,addr_jibun,subst_nm,mtr_no,dl_nm",
    });

  if (error) {
    throw new Error(`kepco_capa upsert failed: ${error.message}`);
  }
  return { upserted: unique.length };
}
