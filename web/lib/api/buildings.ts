/**
 * Client-side fetch wrappers — 건물 atomic endpoints.
 *
 * 두 가지 종류 (한 파일에 공존, vendor 추상화 — 컴포넌트는 어떤 API 인지 모름):
 *   1. 건축물대장 표제부 (텍스트 정보) — 건축HUB API
 *   2. 건물 폴리곤 (지도 그리기용) — VWorld lt_c_spbd
 *
 * 캐시: 둘 다 모듈 scope Map (페이지 라이프타임). 같은 PNU 재호출 0회 fetch.
 * 빈배열 결과도 캐시 (재호출 방지).
 *
 * Endpoint ↔ 함수:
 *   /api/buildings/by-pnu          ↔ fetchBuildingsByPnu          (대장 텍스트)
 *   /api/buildings/polygons/by-pnu ↔ fetchBuildingPolygonsByPnu   (폴리곤)
 */
import type { BuildingTitleInfo } from "@/lib/building-hub/title";
import type { BuildingPolygon } from "@/lib/vworld/buildings";

interface BuildingsApiResponse {
  ok: boolean;
  pnu?: string;
  rows?: BuildingTitleInfo[];
  error?: string;
}

interface BuildingPolygonsApiResponse {
  ok: boolean;
  pnu?: string;
  rows?: BuildingPolygon[];
  error?: string;
}

interface FetchOptions {
  signal?: AbortSignal;
}

const buildingsByPnuCache = new Map<string, BuildingTitleInfo[]>();
const buildingPolygonsByPnuCache = new Map<string, BuildingPolygon[]>();

/** /api/buildings/by-pnu — PNU → 건축물대장 표제부 rows. 캐시 키 = PNU. */
export async function fetchBuildingsByPnu(
  pnu: string,
  options?: FetchOptions,
): Promise<BuildingTitleInfo[]> {
  const cached = buildingsByPnuCache.get(pnu);
  if (cached) return cached;

  const res = await fetch(
    `/api/buildings/by-pnu?pnu=${encodeURIComponent(pnu)}`,
    { signal: options?.signal },
  );
  const data = (await res.json()) as BuildingsApiResponse;
  if (!data.ok) throw new Error(data.error || "건축물대장 조회 실패");
  const rows = data.rows ?? [];
  buildingsByPnuCache.set(pnu, rows);
  return rows;
}

/**
 * /api/buildings/polygons/by-pnu — PNU → 그 필지 위 건물 N동 폴리곤.
 *
 * 견적 모드(/quote/[pnu]) 진입 시 자동 호출. 0건 정상 (가설건축물 미등록).
 */
export async function fetchBuildingPolygonsByPnu(
  pnu: string,
  options?: FetchOptions,
): Promise<BuildingPolygon[]> {
  const cached = buildingPolygonsByPnuCache.get(pnu);
  if (cached) return cached;

  const res = await fetch(
    `/api/buildings/polygons/by-pnu?pnu=${encodeURIComponent(pnu)}`,
    { signal: options?.signal },
  );
  const data = (await res.json()) as BuildingPolygonsApiResponse;
  if (!data.ok) throw new Error(data.error || "건물 폴리곤 조회 실패");
  const rows = data.rows ?? [];
  buildingPolygonsByPnuCache.set(pnu, rows);
  return rows;
}

/** 캐시 초기화 (보통 호출 X — 건물 데이터는 거의 안 변함) */
export function clearBuildingsCache(): void {
  buildingsByPnuCache.clear();
  buildingPolygonsByPnuCache.clear();
}

export type { BuildingTitleInfo, BuildingPolygon };
