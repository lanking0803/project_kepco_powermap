/**
 * 자연취락지구 ↔ 가장 가까운 마을 매칭.
 *
 * VWorld 응답에 마을(읍면동/리) 정보가 없어, 우리 KEPCO 마을 데이터
 * (MapSummaryRow) 중 거리상 가까운 것을 추정 매칭한다.
 *
 * 임계값 (의뢰자 결정 2026-05-02):
 *   1. 취락지구 면적을 원으로 가정 → 직경 D = 2·√(A/π)
 *   2. 임계값 = D × 5
 *   3. 임계값 안에 들어오는 마을 중 거리 가까운 Top 3
 *   4. 0개면 "위치 미매칭"
 *
 * 정밀도 한계:
 *   - 마을 중심점 ↔ 취락지구 중심점 직선거리 (벡터)
 *   - 마을 형태/크기 무시 (실제 영역은 클릭 후 지도에서 시각 확인)
 *   - 표기는 "~일대" 로 모호함 인정
 */
import type { MapSummaryRow } from "@/lib/types";
import type { UqVillage } from "@/lib/vworld/uq-villages";

export interface NearVillage {
  bjd_code: string;
  addr_dong: string | null;
  addr_li: string | null;
  /** 취락지구 중심 ↔ 마을 중심 직선거리 (m) */
  distanceM: number;
  /** 매칭 후보 row 자체 — 클릭 시 마을 진입 핸들러로 그대로 전달 */
  row: MapSummaryRow;
}

export interface UqVillageWithMatches extends UqVillage {
  /** 임계값 안에 들어오는 마을 Top 3 (가까운 순). 빈 배열 = 위치 미매칭. */
  matches: NearVillage[];
}

/** 한국 위도(~37도) 기준 좌표 차이 → 미터 변환. KNN 비교에 충분히 정확. */
function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dy = (a.lat - b.lat) * 111_000; // 위도 1° ≈ 111 km
  const dx = (a.lng - b.lng) * 88_000; // 한국 경도 1° ≈ 88 km
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 취락지구 1개 → 같은 시군구 마을들 중 매칭 후보 Top 3.
 *
 * @param village 취락지구
 * @param candidates 그 시군구의 마을 후보 (sigunguCode prefix 로 미리 필터된 것)
 * @returns 임계값 안에 들어온 마을 거리순. 없으면 빈 배열.
 */
function findMatches(
  village: UqVillage,
  candidates: MapSummaryRow[],
): NearVillage[] {
  // 임계값 = 직경 × 5 = 2·√(A/π) × 5
  const diameter = 2 * Math.sqrt(village.area_m2 / Math.PI);
  const threshold = diameter * 5;

  const inRange: NearVillage[] = [];
  for (const row of candidates) {
    const d = distanceMeters(village.center, { lat: row.lat, lng: row.lng });
    if (d <= threshold) {
      inRange.push({
        bjd_code: row.bjd_code,
        addr_dong: row.addr_dong,
        addr_li: row.addr_li,
        distanceM: d,
        row,
      });
    }
  }

  inRange.sort((a, b) => a.distanceM - b.distanceM);
  return inRange.slice(0, 3);
}

/**
 * 취락지구 N개 ↔ 마을 매칭. 시군구 prefix 필터로 후보를 좁힌 뒤 KNN.
 *
 * @param villages 검색 결과 취락지구
 * @param totalRows 전체 마을 데이터 (브라우저 메모리)
 * @param sigunguCode 검색 대상 시군구 5자리 (bjd_code 앞 5자리)
 */
export function matchUqWithNearestVillages(
  villages: UqVillage[],
  totalRows: MapSummaryRow[],
  sigunguCode: string,
): UqVillageWithMatches[] {
  if (!/^\d{5}$/.test(sigunguCode)) {
    return villages.map((v) => ({ ...v, matches: [] }));
  }
  const candidates = totalRows.filter((r) =>
    r.bjd_code.startsWith(sigunguCode),
  );
  return villages.map((v) => ({ ...v, matches: findMatches(v, candidates) }));
}
