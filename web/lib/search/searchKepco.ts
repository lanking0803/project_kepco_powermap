/**
 * 주소·지번 검색 — Supabase 호출 래퍼 (042 재설계 기준).
 *
 * 042 부터 검색이 2단계로 분리되고 폴백 제거:
 *
 *   1단계 search_address (RPC) — 한글 정규화 LIKE 매칭
 *     · 입력: 클라이언트가 정규화한 단일 문자열
 *             ("충남 부여군 장암면 지토리" → "충청남도부여군장암면지토리")
 *     · DB:  bjd_master sep 합본+공백제거 LIKE
 *     · 결과: 후보 N개 + 마을 단위 정보 (kepco_map_summary LEFT JOIN)
 *
 *   2단계 searchJibun (쿼리빌더) — kepco_capa addr_jibun LIKE
 *     · RPC 가 아닌 supabase-js 쿼리빌더로 직접 호출
 *       (RPC 안 LIKE 가 Postgres plan 함정에 빠지는 이슈 회피)
 *     · 본번만:    addr_jibun = '29' OR LIKE '29-%' OR = '산29' OR LIKE '산29-%'
 *     · 부번까지:  addr_jibun = '29-4' OR = '산29-4'
 *     · 결과: ji 배열. 0건이면 0건. 폴백 없음.
 *
 * 호출 흐름 (route.ts):
 *   1단계 결과 1건 + 본번 있음 → 2단계 자동 호출
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { KepcoDataRow } from "@/lib/types";

/** search_address 가 반환하는 후보 한 행 */
export interface AddressMatch {
  bjd_code: string;
  sep_1: string | null;
  sep_2: string | null;
  sep_3: string | null;
  sep_4: string | null;
  sep_5: string | null;
  /** 5개 sep 를 공백으로 합친 표시용 주소 */
  full_address: string;
  /** kepco_map_summary 매칭 시 마을의 row 수, 없으면 null */
  cnt: number | null;
  lat: number | null;
  lng: number | null;
  geocode_address: string | null;
  addr_do: string | null;
  addr_si: string | null;
  addr_gu: string | null;
  addr_dong: string | null;
  addr_li: string | null;
}

export interface SearchAddressResult {
  matches: AddressMatch[];
}

export interface SearchJibunResult {
  ji: KepcoDataRow[];
}

/**
 * 마을 단위 그룹 결과 — SearchResultList 의 ri 모드가 받는 형태.
 *
 * 두 출처에서 동일 형태로 만들어진다:
 *   1) /api/search 응답 — search_address 결과 중 cnt>0 인 마을
 *   2) FilterPanel — kepco_map_summary 행을 직접 매핑
 */
export interface SearchRiResult {
  addr_do: string | null;
  addr_si: string | null;
  addr_gu: string | null;
  addr_dong: string | null;
  addr_li: string | null;
  geocode_address: string;
  cnt: number;
  lat: number | null;
  lng: number | null;
}

/** AddressMatch (DB) → SearchRiResult (UI 호환) 변환 */
export function toSearchRiResult(m: AddressMatch): SearchRiResult {
  return {
    addr_do: m.addr_do,
    addr_si: m.addr_si,
    addr_gu: m.addr_gu,
    addr_dong: m.addr_dong,
    addr_li: m.addr_li,
    geocode_address: m.geocode_address ?? m.full_address,
    cnt: m.cnt ?? 0,
    lat: m.lat,
    lng: m.lng,
  };
}

/**
 * 1단계: bjd_master 정규화 LIKE 검색.
 * addrNormalized 가 빈 문자열이면 빈 결과.
 */
export async function searchAddress(
  addrNormalized: string,
  matchLimit = 30
): Promise<SearchAddressResult> {
  if (!addrNormalized) {
    return { matches: [] };
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("search_address", {
    addr_normalized: addrNormalized,
    match_limit: matchLimit,
  });
  if (error) {
    throw new Error(`주소 검색 실패: ${error.message}`);
  }

  const payload = (data ?? {}) as { matches?: AddressMatch[] };
  return { matches: payload.matches ?? [] };
}

/**
 * 2단계: kepco_capa 검색 — supabase-js 쿼리빌더 직접 호출.
 *
 * RPC 로 만들면 PostgreSQL의 prepared statement plan caching 함정에 빠져
 * 인덱스를 못 활용 → 풀스캔으로 변질 → 8초+ timeout 발생함이 실측됨.
 * 쿼리빌더로 직접 호출하면 매번 클라이언트가 SQL 을 만들어 서버로 보내고
 * Postgres가 fresh plan 을 짜기 때문에 idx_capa_bjd_code 부분 인덱스가
 * 정상 활용됨 (~30-100ms).
 */
export async function searchJibun(
  bjdCode: string,
  lotMain: number,
  lotSub: number | null = null,
  jiLimit = 10
): Promise<SearchJibunResult> {
  if (!bjdCode || lotMain == null) {
    return { ji: [] };
  }

  const supabase = createAdminClient();

  // addr_jibun 매칭 OR 조건. supabase-js .or() 문법은 콤마 분리 필터 리스트.
  // 본번만: '29' / '29-...' / '산29' / '산29-...'
  // 부번까지: '29-4' / '산29-4'
  const orFilter =
    lotSub == null
      ? [
          `addr_jibun.eq.${lotMain}`,
          `addr_jibun.like.${lotMain}-%`,
          `addr_jibun.eq.산${lotMain}`,
          `addr_jibun.like.산${lotMain}-%`,
        ].join(",")
      : [
          `addr_jibun.eq.${lotMain}-${lotSub}`,
          `addr_jibun.eq.산${lotMain}-${lotSub}`,
        ].join(",");

  const { data, error } = await supabase
    .from("kepco_capa")
    .select(
      "id, bjd_code, addr_jibun, subst_nm, mtr_no, dl_nm, " +
        "subst_capa, subst_pwr, g_subst_capa, " +
        "mtr_capa, mtr_pwr, g_mtr_capa, " +
        "dl_capa, dl_pwr, g_dl_capa, " +
        "step1_cnt, step1_pwr, step2_cnt, step2_pwr, step3_cnt, step3_pwr, " +
        "updated_at"
    )
    .eq("bjd_code", bjdCode)
    .or(orFilter)
    .order("addr_jibun")
    .order("subst_nm")
    .order("mtr_no")
    .order("dl_nm")
    .limit(jiLimit);

  if (error) {
    throw new Error(`지번 검색 실패: ${error.message}`);
  }

  return { ji: (data ?? []) as unknown as KepcoDataRow[] };
}
