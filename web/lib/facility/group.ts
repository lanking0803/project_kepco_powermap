/**
 * 시설 매물 리스트 → 마을(BJD 10자리) 단위 그룹화.
 *
 * 사용:
 *   - 필지 모드 지도 마커는 시설 단위가 아니라 마을 단위로 표시 (경매 패턴 미러).
 *   - 마커 클릭 시 FacilityVillageCard / FacilityVillageModal 에 group.items 직접 전달.
 *
 * 키: BJD 10자리 (`sigunguCd + bjdongCd`).
 * 좌표: 그룹 내 첫 시설의 lat/lng — bjd_master JOIN 결과라 같은 BJD 는 모두 동일.
 */

import type { FacilityListItem } from "./enrich";
import type { FacilityCategory } from "./classify";

export interface FacilityVillageGroup {
  /** 그룹 키 = BJD 10자리 */
  key: string;
  /** 마커 좌표 (그룹 내 첫 시설) */
  lat: number;
  lng: number;
  /** 그룹 내 시설 (정렬 X — 모달이 정렬 담당) */
  items: FacilityListItem[];
  /** 카테고리별 시설 수 */
  categoryCount: Partial<Record<FacilityCategory, number>>;
  /** 평수 통계 — 카드 본체 표시용 */
  totalPyeong: number;
  maxPyeong: number;
  /** 시도/시군구/읍면동 한글명 — platPlc/newPlatPlc 에서 추출. 카드 헤더용. */
  sd: string;
  sgg: string;
  emd: string;
}

/**
 * 시설 리스트 → 마을 그룹.
 *
 * lat/lng 누락(bjd_master 미수록)은 마커 표시 불가 → 제외.
 * BJD 가 비어있는 row 도 제외 (정상 응답에선 거의 없음).
 */
export function groupFacilityItemsByVillage(
  items: FacilityListItem[],
): FacilityVillageGroup[] {
  const map = new Map<string, FacilityVillageGroup>();
  for (const it of items) {
    if (it.lat == null || it.lng == null) continue;
    const sigungu = (it.building.sigunguCd ?? "").trim();
    const bjdong = (it.building.bjdongCd ?? "").trim();
    if (!/^\d{5}$/.test(sigungu) || !/^\d{5}$/.test(bjdong)) continue;
    const key = sigungu + bjdong;

    let g = map.get(key);
    if (!g) {
      const { sd, sgg, emd } = parseAddrParts(
        it.building.platPlc ?? it.building.newPlatPlc ?? "",
      );
      g = {
        key,
        lat: it.lat,
        lng: it.lng,
        items: [],
        categoryCount: {},
        totalPyeong: 0,
        maxPyeong: 0,
        sd,
        sgg,
        emd,
      };
      map.set(key, g);
    }
    g.items.push(it);
    g.categoryCount[it.category] = (g.categoryCount[it.category] ?? 0) + 1;
    if (it.pyeong != null) {
      g.totalPyeong += it.pyeong;
      if (it.pyeong > g.maxPyeong) g.maxPyeong = it.pyeong;
    }
  }
  return [...map.values()];
}

/**
 * "서울특별시 강남구 삼성동 159번지" → { sd, sgg, emd }.
 *
 * 건축HUB platPlc 형식이 정형이라 공백 분할로 충분.
 * 광역시·도, 시·군·구, 동·읍·면 + 이후는 무시 (지번까지 들어있음).
 */
function parseAddrParts(addr: string): {
  sd: string;
  sgg: string;
  emd: string;
} {
  const parts = addr.trim().split(/\s+/);
  return {
    sd: parts[0] ?? "",
    sgg: parts[1] ?? "",
    emd: parts[2] ?? "",
  };
}
