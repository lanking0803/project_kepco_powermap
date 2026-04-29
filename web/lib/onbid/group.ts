/**
 * 공매 매물 리스트 → 마을(시도+시군구+읍면동) 단위 그룹화.
 *
 * 사용:
 *   - 공매 모드 지도 마커는 매물 단위가 아니라 마을 단위로 표시.
 *   - 마커 클릭 시 OnbidVillageCard / OnbidVillageModal 에 group.items 직접 전달.
 *
 * 키: lctnSdnm + lctnSggnm + lctnEmdNm (캠코 응답 그대로).
 * 좌표: 그룹 내 첫 매물의 lat/lng (PNU 앞 10자리 → bjd_master 결과는 동 단위라 모두 동일).
 */

import type { OnbidListItem, OurCategory } from "./types";

export interface OnbidVillageGroup {
  /** 그룹 키 — `${sd}|${sgg}|${emd}` */
  key: string;
  sd: string;
  sgg: string;
  emd: string;
  /** 마커 좌표 (그룹 내 첫 매물) */
  lat: number;
  lng: number;
  /** 그룹 내 매물 (정렬 X — 모달이 정렬 담당) */
  items: OnbidListItem[];
  /** 임박(D-3 이내) 매물이 1건이라도 있으면 true — 마커 펄스 강조용 */
  hasUrgent: boolean;
  /** 카테고리별 매물 수 */
  categoryCount: Partial<Record<OurCategory, number>>;
  /** 평균 할인율 (0~1) */
  avgDiscountRatio: number;
  /** 가장 임박한 D-day (마감 제외, 그룹 내 최소). 모두 마감이면 null */
  minDaysLeft: number | null;
}

/** 매물 리스트 → 마을 그룹 리스트. lat/lng 없는 매물은 제외. */
export function groupOnbidItemsByVillage(
  items: OnbidListItem[],
): OnbidVillageGroup[] {
  const map = new Map<string, OnbidVillageGroup>();
  for (const it of items) {
    if (it.lat == null || it.lng == null) continue;
    const key = `${it.lctnSdnm}|${it.lctnSggnm}|${it.lctnEmdNm}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        sd: it.lctnSdnm,
        sgg: it.lctnSggnm,
        emd: it.lctnEmdNm,
        lat: it.lat,
        lng: it.lng,
        items: [],
        hasUrgent: false,
        categoryCount: {},
        avgDiscountRatio: 0,
        minDaysLeft: null,
      };
      map.set(key, g);
    }
    g.items.push(it);
    if (it.isUrgent && it.daysLeft >= 0) g.hasUrgent = true;
    if (it.ourCategory) {
      g.categoryCount[it.ourCategory] =
        (g.categoryCount[it.ourCategory] ?? 0) + 1;
    }
    if (it.daysLeft >= 0) {
      g.minDaysLeft =
        g.minDaysLeft == null ? it.daysLeft : Math.min(g.minDaysLeft, it.daysLeft);
    }
  }
  // 통계 마무리
  for (const g of map.values()) {
    const sum = g.items.reduce((s, i) => s + i.discountRatio, 0);
    g.avgDiscountRatio = g.items.length > 0 ? sum / g.items.length : 0;
  }
  return [...map.values()];
}
