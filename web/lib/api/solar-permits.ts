/**
 * Client-side fetch wrapper — 태양광 발전소 atomic endpoint.
 *
 * Endpoint ↔ 함수:
 *   /api/solar-permits/by-pnu  ↔  fetchSolarByPnu
 *
 * 응답: {
 *   samePnu:         같은 필지 발전소 리스트,
 *   sameDong:        동/리 단위 집계 (count, totalKw),
 *   sameDongMarkers: 좌표 보유 발전소만 (지도 마커용 — count 보다 적을 수 있음)
 * }
 *
 * 캐시: 모듈 scope Map (페이지 라이프타임). 같은 PNU 재호출 0회.
 *       매월 1일 09시 KST 적재되는 정적 스냅샷이라 페이지 라이프타임 안전.
 */

export interface SolarPermitRow {
  facility_name: string;
  capacity_kw: number | null;
  operating_status: string | null;
  /** YYYY-MM-DD */
  permit_date: string | null;
  lat: number | null;
  lng: number | null;
}

export interface SolarMarker {
  lat: number;
  lng: number;
  pnu: string;
  /** "821" / "821-3" / "산 87-4" — 사람이 읽을 본번-부번 */
  jibun: string;
  name: string;
  kw: number | null;
}

export interface SolarByPnuResult {
  samePnu: SolarPermitRow[];
  sameDong: { count: number; totalKw: number };
  sameDongMarkers: SolarMarker[];
}

interface SolarByPnuApiResponse {
  ok: boolean;
  pnu?: string;
  bjd_code?: string;
  same_pnu?: SolarPermitRow[];
  same_dong?: { count: number; total_kw: number };
  same_dong_markers?: SolarMarker[];
  error?: string;
}

interface FetchOptions {
  signal?: AbortSignal;
}

const solarByPnuCache = new Map<string, SolarByPnuResult>();

/** /api/solar-permits/by-pnu — PNU → 같은 필지 + 같은 동/리 집계 + 마커. 캐시 키 = PNU. */
export async function fetchSolarByPnu(
  pnu: string,
  options?: FetchOptions,
): Promise<SolarByPnuResult> {
  const cached = solarByPnuCache.get(pnu);
  if (cached) return cached;

  const res = await fetch(
    `/api/solar-permits/by-pnu?pnu=${encodeURIComponent(pnu)}`,
    { signal: options?.signal },
  );
  const data = (await res.json()) as SolarByPnuApiResponse;
  if (!data.ok) throw new Error(data.error || "태양광 발전소 조회 실패");

  const result: SolarByPnuResult = {
    samePnu: data.same_pnu ?? [],
    sameDong: {
      count: data.same_dong?.count ?? 0,
      totalKw: data.same_dong?.total_kw ?? 0,
    },
    sameDongMarkers: data.same_dong_markers ?? [],
  };
  solarByPnuCache.set(pnu, result);
  return result;
}

/** 캐시 초기화 (보통 호출 X — 월 1회 갱신이라 페이지 라이프타임 안전) */
export function clearSolarCache(): void {
  solarByPnuCache.clear();
}
