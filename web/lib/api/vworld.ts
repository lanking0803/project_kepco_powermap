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
 *   /api/parcel/by-pnu        ↔ fetchVworldParcelByPnu
 *   /api/parcel/by-latlng     ↔ fetchVworldParcelByLatLng
 *   /api/polygon/by-bjd       ↔ fetchVworldAdminPolygonByBjdCode
 *   /api/uq-villages/by-bjd   ↔ fetchVworldUqVillagesByBjdCode
 */
import type { JibunInfo, ParcelGeometry } from "@/lib/vworld/parcel";
import type { AdminPolygonResult } from "@/lib/vworld/admin-polygon";
import type { UqVillage } from "@/lib/vworld/uq-villages";

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

interface UqVillagesApiResponse {
  ok: boolean;
  bjd_code?: string;
  sgg_code?: string;
  count?: number;
  villages?: UqVillage[];
  error?: string;
}

interface FetchOptions {
  signal?: AbortSignal;
}

const parcelByPnuCache = new Map<string, ParcelLookupResult | null>();
const polygonByBjdCache = new Map<string, AdminPolygonResult | null>();
// 자연취락지구는 시군구 단위 응답 → 캐시 키도 시군구 5자리.
// 같은 시군구의 다른 마을 클릭 시 즉시 재사용.
const uqVillagesBySggCache = new Map<string, UqVillage[]>();
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

/**
 * /api/uq-villages/by-bjd — 자연취락지구 폴리곤.
 * 입력은 bjd_code 10자리지만 응답·캐시는 시군구(앞 5자리) 단위.
 * 같은 시군구의 다른 마을을 클릭해도 캐시 hit (외부 호출 0).
 *
 * ⚠️ 마을 클릭 자동 표시 등 단일 sgg 호출 전용. 검색 모드는
 * fetchVworldUqVillagesByQuery 를 사용 (일반시 일반구 시 단위 합치기).
 */
export async function fetchVworldUqVillagesByBjdCode(
  bjdCode: string,
  options?: FetchOptions,
): Promise<UqVillage[]> {
  if (!/^\d{10}$/.test(bjdCode)) return [];
  const sggKey = bjdCode.slice(0, 5);
  const cached = uqVillagesBySggCache.get(sggKey);
  if (cached) return cached;

  const res = await fetch(
    `/api/uq-villages/by-bjd?bjd_code=${encodeURIComponent(bjdCode)}`,
    { signal: options?.signal },
  );
  const data = (await res.json()) as UqVillagesApiResponse;
  if (!data.ok) throw new Error(data.error || "자연취락지구 조회 실패");
  const villages = data.villages ?? [];
  uqVillagesBySggCache.set(sggKey, villages);
  return villages;
}

/**
 * 검색 모드용 — 사용자가 선택한 시군구 5자리에 대해
 * VWorld 등록 단위 함정을 우회하기 위해 1~2개 sgg 코드를 모두 호출하고 합친다.
 *
 * 일반시 일반구(예: 41135 분당구) 검색 시 시 단위(41130) + 구 단위(41135)
 * 모두 호출해서 mnum dedup. 일반 군/광역시 자치구는 단일 호출.
 *
 * 캐시 hit 시 외부 호출 0.
 */
export async function fetchVworldUqVillagesByQuery(
  sggCodes: string[],
  options?: FetchOptions,
): Promise<UqVillage[]> {
  if (sggCodes.length === 0) return [];
  const results = await Promise.all(
    sggCodes.map((sgg) =>
      fetchVworldUqVillagesByBjdCode(`${sgg}00000`, options),
    ),
  );
  // mnum 기반 dedup — 시 단위 호출과 구 단위 호출에 같은 폴리곤이 중복 등록될
  // 가능성은 낮지만 안전장치.
  const seen = new Set<string>();
  const merged: UqVillage[] = [];
  for (const list of results) {
    for (const v of list) {
      const key = v.mnum || `${v.center.lat},${v.center.lng}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(v);
    }
  }
  return merged;
}

/** VWorld 캐시 초기화 — 필지/폴리곤은 거의 안 변하므로 보통 호출 X */
export function clearVworldCache(): void {
  parcelByPnuCache.clear();
  polygonByBjdCache.clear();
  uqVillagesBySggCache.clear();
}
