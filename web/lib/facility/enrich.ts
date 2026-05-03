/**
 * 시설 검색 결과 enrich — bjd_master JOIN 으로 좌표 보강.
 *
 * 공매·경매 enrich 와 같은 패턴:
 *   - rows 의 BJD 10자리(`sigunguCd + bjdongCd`) unique → bjd_master IN 1회 조회
 *   - 결과를 BuildingTitleInfo 그대로에 lat/lng 만 덧대 FacilityListItem 으로 반환
 *
 * 좌표 누락 row 는 lat/lng = null (UI 마커는 클라이언트에서 자동 제외).
 */
import type { BuildingTitleInfo } from "@/lib/building-hub/title";
import {
  classifyBuilding,
  m2ToPyeong,
  type FacilityCategory,
} from "@/lib/facility/classify";
import { createAdminClient } from "@/lib/supabase/admin";

/** 시설 1건 — 검색 응답 단위. 마커/카드/모달 공용. */
export interface FacilityListItem {
  building: BuildingTitleInfo;
  /** classifyBuilding 결과. null(부속건축물) 은 enrich 단계에서 제외됨. */
  category: FacilityCategory;
  /** 평 환산 (archArea ÷ 3.305785). null = archArea 미상 */
  pyeong: number | null;
  /** bjd_master JOIN 결과. 누락 시 null — 마커 표시에서 자동 제외. */
  lat: number | null;
  lng: number | null;
}

/**
 * BuildingTitleInfo[] → FacilityListItem[].
 *
 * 분류·좌표 보강 한 번에. 부속건축물(category=null)은 자동 제외.
 */
export async function enrichFacilities(
  rows: BuildingTitleInfo[],
): Promise<FacilityListItem[]> {
  // 1) 분류 — 부속건축물 제외, 카테고리 박기
  const classified: Array<{
    building: BuildingTitleInfo;
    category: FacilityCategory;
    pyeong: number | null;
    bjdCode: string | null;
  }> = [];
  for (const b of rows) {
    const cat = classifyBuilding(b);
    if (cat == null) continue;
    const sigungu = (b.sigunguCd ?? "").trim();
    const bjdong = (b.bjdongCd ?? "").trim();
    const bjdCode =
      /^\d{5}$/.test(sigungu) && /^\d{5}$/.test(bjdong)
        ? sigungu + bjdong
        : null;
    classified.push({
      building: b,
      category: cat,
      pyeong: m2ToPyeong(b.archArea),
      bjdCode,
    });
  }

  if (classified.length === 0) return [];

  // 2) bjd_master 일괄 좌표 조회 (공매/경매 패턴)
  const bjdSet = new Set<string>();
  for (const c of classified) {
    if (c.bjdCode) bjdSet.add(c.bjdCode);
  }

  const coordMap = new Map<string, { lat: number | null; lng: number | null }>();
  if (bjdSet.size > 0) {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("bjd_master")
      .select("bjd_code, lat, lng")
      .in("bjd_code", Array.from(bjdSet));
    if (error) {
      console.error("[facility/enrich] bjd_master 조회 실패", error);
    } else {
      for (const row of data ?? []) {
        coordMap.set(row.bjd_code, {
          lat: row.lat ?? null,
          lng: row.lng ?? null,
        });
      }
    }
  }

  // 3) 좌표 박아 반환
  return classified.map((c) => {
    const coord = c.bjdCode ? coordMap.get(c.bjdCode) : null;
    return {
      building: c.building,
      category: c.category,
      pyeong: c.pyeong,
      lat: coord?.lat ?? null,
      lng: coord?.lng ?? null,
    };
  });
}
