/**
 * Client-side fetch wrappers — VWorld 필지/행정구역 atomic endpoints.
 *
 * 컴포넌트는 이 파일의 함수만 호출. 서버 lib (lib/vworld/parcel.ts, admin-polygon.ts) 는
 * route.ts 가 직접 사용하는 server-only — 여기서는 type 만 import.
 *
 * 캐시:
 *   - by-pnu, by-bjd-polygon: 모듈 scope Map (필지/행정구역은 거의 안 변함, 라이프타임 유지)
 *   - by-latlng: 캐시 X (좌표 픽셀마다 다름 — Map 무한 증가 위험. 응답 PNU 가 by-pnu 캐시에 들어가
 *     이후 같은 필지 클릭은 효과 받음)
 *
 * Endpoint ↔ 함수 매핑:
 *   /api/parcel/by-pnu     ↔ fetchVworldParcelByPnu
 *   /api/parcel/by-latlng  ↔ fetchVworldParcelByLatLng
 *   /api/polygon/by-bjd    ↔ fetchVworldAdminPolygonByBjdCode
 */
import type { JibunInfo, ParcelGeometry } from "@/lib/vworld/parcel";
import type { AdminPolygonResult } from "@/lib/vworld/admin-polygon";

export interface ParcelLookupResult {
  jibun: JibunInfo;
  geometry: ParcelGeometry;
}

interface ParcelApiResponse {
  ok: boolean;
  pnu?: string;
  lat?: number;
  lng?: number;
  jibun?: JibunInfo | null;
  geometry?: ParcelGeometry | null;
  error?: string;
}

interface PolygonApiResponse {
  ok: boolean;
  bjd_code?: string;
  level?: "ri" | "emd" | null;
  full_nm?: string | null;
  polygon?: AdminPolygonResult["polygon"] | null;
  center?: { lat: number; lng: number } | null;
  error?: string;
}

interface FetchOptions {
  signal?: AbortSignal;
}

const parcelByPnuCache = new Map<string, ParcelLookupResult | null>();
const polygonByBjdCache = new Map<string, AdminPolygonResult | null>();
// inflight Promise 캐시 — 같은 PNU 동시 호출(MapClient + ParcelInfoPanel + StrictMode 등)
// 시 첫 호출의 Promise 를 재사용해 fetch 1회로 합침. resolve 후엔 결과 캐시로 이관.
const parcelByPnuInflight = new Map<string, Promise<ParcelLookupResult | null>>();

/** /api/parcel/by-pnu — PNU 19자리 → 필지. 캐시 키 = PNU. null 결과도 캐시 (재호출 방지) */
export async function fetchVworldParcelByPnu(
  pnu: string,
  options?: FetchOptions,
): Promise<ParcelLookupResult | null> {
  if (parcelByPnuCache.has(pnu)) return parcelByPnuCache.get(pnu)!;

  // 같은 PNU 동시 호출은 첫 fetch Promise 를 공유 (signal 은 첫 호출 것만 적용)
  const existing = parcelByPnuInflight.get(pnu);
  if (existing) return existing;

  const promise = (async () => {
    const res = await fetch(`/api/parcel/by-pnu?pnu=${encodeURIComponent(pnu)}`, {
      signal: options?.signal,
    });
    const data = (await res.json()) as ParcelApiResponse;
    if (!data.ok) throw new Error(data.error || "필지(PNU) 조회 실패");
    const result =
      data.jibun && data.geometry
        ? { jibun: data.jibun, geometry: data.geometry }
        : null;
    parcelByPnuCache.set(pnu, result);
    return result;
  })().finally(() => {
    parcelByPnuInflight.delete(pnu);
  });

  parcelByPnuInflight.set(pnu, promise);
  return promise;
}

/** /api/parcel/by-latlng — 좌표 → 필지 (캐시 X, 좌표 픽셀마다 다름) */
export async function fetchVworldParcelByLatLng(
  lat: number,
  lng: number,
  options?: FetchOptions,
): Promise<ParcelLookupResult | null> {
  const res = await fetch(`/api/parcel/by-latlng?lat=${lat}&lng=${lng}`, {
    signal: options?.signal,
  });
  const data = (await res.json()) as ParcelApiResponse;
  if (!data.ok) throw new Error(data.error || "필지(좌표) 조회 실패");
  if (!data.jibun || !data.geometry) return null;
  return { jibun: data.jibun, geometry: data.geometry };
}

/** /api/polygon/by-bjd — 행정구역 폴리곤. 캐시 키 = bjd_code. null 결과도 캐시. */
export async function fetchVworldAdminPolygonByBjdCode(
  bjdCode: string,
  options?: FetchOptions,
): Promise<AdminPolygonResult | null> {
  if (polygonByBjdCache.has(bjdCode)) return polygonByBjdCache.get(bjdCode)!;

  const res = await fetch(
    `/api/polygon/by-bjd?bjd_code=${encodeURIComponent(bjdCode)}`,
    { signal: options?.signal },
  );
  const data = (await res.json()) as PolygonApiResponse;
  if (!data.ok) throw new Error(data.error || "행정구역 폴리곤 조회 실패");
  const result =
    data.level && data.polygon && data.center
      ? {
          bjd_code: bjdCode,
          level: data.level,
          full_nm: data.full_nm ?? "",
          polygon: data.polygon,
          center: data.center,
        }
      : null;
  polygonByBjdCache.set(bjdCode, result);
  return result;
}

/** VWorld 캐시 초기화 — 필지/폴리곤은 거의 안 변하므로 보통 호출 X */
export function clearVworldCache(): void {
  parcelByPnuCache.clear();
  polygonByBjdCache.clear();
}
