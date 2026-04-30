/**
 * KepcoCapaRow enrichment — bjd_code 로 MapSummaryRow 매칭해 마을 주소/좌표 주입.
 *
 * 배경: kepco_capa 는 bjd_code + 시설/용량만 저장 (정규화). 주소/좌표는
 * bjd_master(MV) 에 분리. UI 컴포넌트 (LocationSummaryCard, LocationDetailModal,
 * SearchResultList) 는 row.addr_do/li 시멘틱이라, fetch 직후 클라이언트가 채워 넣음.
 * DB 재조회/조인 없이 in-memory 매핑.
 *
 * 사용처:
 *   - MapClient: openVillagePanelOnMarkerClick 안에서 /api/capa/by-bjd 응답 enrich
 *   - Sidebar  : /api/search 응답 ji 결과 enrich (042 search_jibun 응답에도 동일 적용)
 */
import type { KepcoDataRow, MapSummaryRow } from "@/lib/types";

/** 단일 row 에 마을 정보 주입 */
export function enrichKepcoCapaRowWithVillageInfo(
  row: KepcoDataRow,
  village: MapSummaryRow,
): KepcoDataRow {
  return {
    ...row,
    addr_do: village.addr_do,
    addr_si: village.addr_si,
    addr_gu: village.addr_gu,
    addr_dong: village.addr_dong,
    addr_li: village.addr_li,
    geocode_address: village.geocode_address,
    lat: village.lat,
    lng: village.lng,
  };
}

/** rows 배열을 마을 인덱스(bjd_code → MapSummaryRow) 로 일괄 enrich */
export function enrichKepcoCapaRowsWithVillageInfo(
  rows: KepcoDataRow[],
  villages: MapSummaryRow[],
): KepcoDataRow[] {
  const idx = new Map<string, MapSummaryRow>();
  for (const v of villages) idx.set(v.bjd_code, v);
  return rows.map((r) => {
    const v = idx.get(r.bjd_code);
    return v ? enrichKepcoCapaRowWithVillageInfo(r, v) : r;
  });
}
