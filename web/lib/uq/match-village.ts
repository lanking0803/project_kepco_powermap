/**
 * 자연취락지구 ↔ 가장 가까운 마을 매칭 (시군구 경계 무시 버전).
 *
 * VWorld 응답에 마을(읍면동/리) 정보가 없어, 우리 KEPCO 마을 데이터
 * (MapSummaryRow) 중 거리상 가까운 것을 추정 매칭한다.
 *
 * 매칭 정책 (의뢰자 결정 2026-05-02 ~ 2026-05-03):
 *   1. 시군구 경계 무시 — 강화군처럼 KEPCO 데이터 0인 시군구도
 *      옆 시군구(김포시 등) 마을이 후보로 들어와야 영업 의미
 *   2. 절대 상한 = 20km. 그 이상은 영업 가치 0
 *   3. 가까운 Top 3 표시 (없으면 "근처 마을 데이터 없음")
 *   4. 카드의 거리 칩으로 영업이 신뢰도 자체 판단
 *
 * 성능:
 *   130만 행 전부 거리 계산은 12초+ 부담.
 *   위도순 정렬 인덱스(buildLatIndex, 앱 1회 1.6초) + binary search 로
 *   BBox 안 ~수천 행만 거리 계산. 검색 1회 ~30ms.
 */
import type { MapSummaryRow } from "@/lib/types";
import type { UqVillage } from "@/lib/vworld/uq-villages";
import {
  findNearestRowsByLatIndex,
  type LatIndex,
} from "./sorted-by-lat";

/** 매칭 거리 절대 상한 (m). 20km 초과는 영업 가치 0 으로 판단. */
const MAX_DISTANCE_M = 20_000;
/** 표시할 최대 마을 수. */
const TOP_N = 3;

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
  /** 가까운 마을 Top 3 (가까운 순). 빈 배열 = 20km 안에 마을 0개. */
  matches: NearVillage[];
}

/**
 * 취락지구 N개 ↔ 마을 매칭. 시군구 경계 무시.
 *
 * @param villages 검색 결과 취락지구
 * @param latIndex 위도순 정렬 인덱스 (앱 마운트 시 1회 빌드, useMemo 캐시)
 */
export function matchUqWithNearestVillages(
  villages: UqVillage[],
  latIndex: LatIndex | null,
): UqVillageWithMatches[] {
  if (!latIndex) {
    // 인덱스 미준비 시 매칭 보류 (정렬 비동기 진행 중)
    return villages.map((v) => ({ ...v, matches: [] }));
  }
  return villages.map((v) => {
    const nearest = findNearestRowsByLatIndex(
      latIndex,
      v.center,
      MAX_DISTANCE_M,
      MAX_DISTANCE_M,
      TOP_N,
    );
    const matches: NearVillage[] = nearest.map(({ row, distanceM }) => ({
      bjd_code: row.bjd_code,
      addr_dong: row.addr_dong,
      addr_li: row.addr_li,
      distanceM,
      row,
    }));
    return { ...v, matches };
  });
}
