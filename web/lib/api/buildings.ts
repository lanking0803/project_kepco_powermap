/**
 * Client-side fetch wrappers — 건물 atomic endpoints.
 *
 * 세 가지 종류 (한 파일에 공존, vendor 추상화 — 컴포넌트는 어떤 API 인지 모름):
 *   1. 건축물대장 표제부 단건 (텍스트 정보) — 건축HUB API
 *   2. 건물 폴리곤 (지도 그리기용) — VWorld lt_c_spbd
 *   3. 건축물대장 표제부 일괄 (시설 모드) — 건축HUB API (법정동 단위)
 *
 * 캐시: 모듈 scope Map (페이지 라이프타임). 같은 키 재호출 0회 fetch.
 * 빈배열 결과도 캐시 (재호출 방지).
 *
 * Endpoint ↔ 함수:
 *   /api/buildings/by-pnu          ↔ fetchBuildingsByPnu          (대장 텍스트 단건)
 *   /api/buildings/polygons/by-pnu ↔ fetchBuildingPolygonsByPnu   (폴리곤)
 *   /api/buildings/list/by-bjd     ↔ fetchBuildingsByBjd          (대장 일괄, 시설 모드)
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

interface BuildingsListApiResponse {
  ok: boolean;
  bjd_code?: string;
  page_no?: number;
  num_of_rows?: number;
  total_count?: number;
  has_more?: boolean;
  rows?: BuildingTitleInfo[];
  error?: string;
}

interface FetchOptions {
  signal?: AbortSignal;
}

const buildingsByPnuCache = new Map<string, BuildingTitleInfo[]>();
const buildingPolygonsByPnuCache = new Map<string, BuildingPolygon[]>();
/** 시설 모드 — bjd_code+pageNo+numOfRows 키별 캐시 */
const buildingsByBjdCache = new Map<string, BuildingsByBjdResult>();

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

// ────────────────────────────────────────────────────────────
//  시설 모드 — 법정동 단위 일괄 조회
// ────────────────────────────────────────────────────────────

export interface BuildingsByBjdResult {
  bjdCode: string;
  pageNo: number;
  numOfRows: number;
  totalCount: number;
  hasMore: boolean;
  rows: BuildingTitleInfo[];
}

export interface FetchBuildingsByBjdOptions extends FetchOptions {
  pageNo?: number;
  numOfRows?: number;
}

/**
 * /api/buildings/list/by-bjd — 법정동 1개 안의 건축물대장 표제부 일괄 (단일 페이지).
 *
 * 시설 모드 검색 진입 시 호출. 페이지네이션은 호출자가 hasMore 보고 추가 요청.
 * 캐시 키 = bjd_code + page_no + num_of_rows.
 */
export async function fetchBuildingsByBjd(
  bjdCode: string,
  options?: FetchBuildingsByBjdOptions,
): Promise<BuildingsByBjdResult> {
  const pageNo = Math.max(1, Math.floor(options?.pageNo ?? 1));
  // 외부 API 100 hard cap (실측 2026-05-03). 큰 값 보내도 100 만 응답.
  const numOfRows = Math.min(100, Math.max(1, Math.floor(options?.numOfRows ?? 100)));
  const cacheKey = `${bjdCode}|${pageNo}|${numOfRows}`;
  const cached = buildingsByBjdCache.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    bjd_code: bjdCode,
    page_no: String(pageNo),
    num_of_rows: String(numOfRows),
  });
  const res = await fetch(`/api/buildings/list/by-bjd?${params.toString()}`, {
    signal: options?.signal,
  });
  const data = (await res.json()) as BuildingsListApiResponse;
  if (!data.ok) throw new Error(data.error || "건축물대장 일괄 조회 실패");

  const result: BuildingsByBjdResult = {
    bjdCode: data.bjd_code ?? bjdCode,
    pageNo: data.page_no ?? pageNo,
    numOfRows: data.num_of_rows ?? numOfRows,
    totalCount: data.total_count ?? 0,
    hasMore: data.has_more ?? false,
    rows: data.rows ?? [],
  };
  buildingsByBjdCache.set(cacheKey, result);
  return result;
}

// ────────────────────────────────────────────────────────────
//  시설 모드 — 자동 페이지 순회 (전체 결과 합치기)
// ────────────────────────────────────────────────────────────

export interface FetchAllBuildingsByBjdOptions extends FetchOptions {
  /** 페이지당 행수 (기본 100, 외부 API hard cap) */
  numOfRows?: number;
  /**
   * 최대 페이지 수 (기본 20). 외부 API 100건 hard cap × 20 = 최대 2,000건.
   * 도시 큰 동(역삼동 5천건+)은 처음 2,000건만 받고 capped 응답.
   */
  maxPages?: number;
  /** 페이지 1장 받을 때마다 호출 (점진 표시 용 — 옵션) */
  onProgress?: (info: { pageNo: number; pageCount: number; receivedSoFar: number; totalCount: number }) => void;
}

export interface FetchAllBuildingsByBjdResult {
  bjdCode: string;
  /** 외부 API 가 알려준 매치 전체 건수 */
  totalCount: number;
  /** 우리가 실제로 받은 페이지 수 */
  pageCount: number;
  /** 캡 도달로 잘렸는지 (true 면 사용자에게 안내 필요) */
  capped: boolean;
  /** 모든 페이지 합쳐진 행들 */
  rows: BuildingTitleInfo[];
}

const fetchAllByBjdCache = new Map<string, FetchAllBuildingsByBjdResult>();

/**
 * 법정동 단위 일괄 조회 — 자동 페이지 순회로 최대 maxPages 까지.
 *
 * 시설 모드 검색 흐름:
 *   1. 사용자 [검색] 클릭
 *   2. 이 함수가 page 1, 2, ... maxPages 까지 순차 호출
 *   3. 합친 결과를 클라이언트에서 카테고리/평수 필터
 *
 * 캐시: 같은 bjdCode 두 번째 호출은 0회 fetch (페이지 합친 결과 그대로).
 */
export async function fetchAllBuildingsByBjd(
  bjdCode: string,
  options?: FetchAllBuildingsByBjdOptions,
): Promise<FetchAllBuildingsByBjdResult> {
  const cached = fetchAllByBjdCache.get(bjdCode);
  if (cached) return cached;

  const numOfRows = Math.min(100, Math.max(1, Math.floor(options?.numOfRows ?? 100)));
  const maxPages = Math.max(1, Math.floor(options?.maxPages ?? 20));

  const allRows: BuildingTitleInfo[] = [];
  let totalCount = 0;
  let pageCount = 0;
  let capped = false;

  for (let page = 1; page <= maxPages; page++) {
    const pageResult = await fetchBuildingsByBjd(bjdCode, {
      pageNo: page,
      numOfRows,
      signal: options?.signal,
    });
    pageCount = page;
    totalCount = pageResult.totalCount;
    allRows.push(...pageResult.rows);

    options?.onProgress?.({
      pageNo: page,
      pageCount: page,
      receivedSoFar: allRows.length,
      totalCount: pageResult.totalCount,
    });

    // 더 받을 게 없거나 (마지막 페이지 도달)
    if (!pageResult.hasMore) break;
    // 빈 페이지 나오면 종료 (서버 응답 이상 방어)
    if (pageResult.rows.length === 0) break;
    // 이번이 maxPages 인데 hasMore=true 면 capped
    if (page === maxPages && pageResult.hasMore) {
      capped = true;
      break;
    }
  }

  const result: FetchAllBuildingsByBjdResult = {
    bjdCode,
    totalCount,
    pageCount,
    capped,
    rows: allRows,
  };
  fetchAllByBjdCache.set(bjdCode, result);
  return result;
}

// ────────────────────────────────────────────────────────────
//  시설 모드 — 다중 bjd_code 병렬 조회 (농촌 읍/면 "리 전체")
// ────────────────────────────────────────────────────────────

export interface FetchAllBuildingsByBjdMultiOptions extends FetchOptions {
  numOfRows?: number;
  maxPages?: number;
  /**
   * 동시 호출 한도 (기본 5). 너무 크면 외부 API 부담 + 한도 빠르게 소진.
   * 보통 5~10 사이가 안전.
   */
  concurrency?: number;
  /** bjd_code 1개 끝날 때마다 호출 (점진 표시 용) */
  onBjdComplete?: (info: {
    bjdCode: string;
    completed: number;
    total: number;
    rowsAdded: number;
    totalRowsSoFar: number;
  }) => void;
}

export interface FetchAllBuildingsByBjdMultiResult {
  /** 합쳐진 모든 행들 */
  rows: BuildingTitleInfo[];
  /** bjd_code 별 결과 (실패한 것 포함) */
  perBjd: Array<{
    bjdCode: string;
    totalCount: number;
    pageCount: number;
    capped: boolean;
    rows: BuildingTitleInfo[];
    error?: string;
  }>;
  /** 외부 API 매치 전체 합계 (capped 와 무관, 서버가 알려준 totalCount 합) */
  totalCountSum: number;
  /** 어느 하나라도 capped */
  anyCapped: boolean;
}

/**
 * 다중 bjd_code 일괄 조회 — 병렬로 fetchAllBuildingsByBjd N개 동시 실행.
 *
 * 농촌 읍/면 "리 전체" 시나리오 용. 예) 구례군 구례읍 = 10개 리 동시 호출.
 * concurrency 만큼 동시 진행, 끝난 것부터 다음 것 시작 (worker pool).
 */
export async function fetchAllBuildingsByBjdMulti(
  bjdCodes: string[],
  options?: FetchAllBuildingsByBjdMultiOptions,
): Promise<FetchAllBuildingsByBjdMultiResult> {
  const concurrency = Math.max(1, Math.floor(options?.concurrency ?? 5));
  const total = bjdCodes.length;
  const perBjd: FetchAllBuildingsByBjdMultiResult["perBjd"] = new Array(total);
  let completed = 0;
  let totalRowsSoFar = 0;

  // worker pool 패턴
  let nextIdx = 0;
  async function worker() {
    while (true) {
      const idx = nextIdx++;
      if (idx >= total) return;
      const bjdCode = bjdCodes[idx];
      try {
        const r = await fetchAllBuildingsByBjd(bjdCode, {
          numOfRows: options?.numOfRows,
          maxPages: options?.maxPages,
          signal: options?.signal,
        });
        perBjd[idx] = {
          bjdCode,
          totalCount: r.totalCount,
          pageCount: r.pageCount,
          capped: r.capped,
          rows: r.rows,
        };
        completed++;
        totalRowsSoFar += r.rows.length;
        options?.onBjdComplete?.({
          bjdCode,
          completed,
          total,
          rowsAdded: r.rows.length,
          totalRowsSoFar,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        perBjd[idx] = {
          bjdCode,
          totalCount: 0,
          pageCount: 0,
          capped: false,
          rows: [],
          error: msg,
        };
        completed++;
        options?.onBjdComplete?.({
          bjdCode,
          completed,
          total,
          rowsAdded: 0,
          totalRowsSoFar,
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, () => worker()),
  );

  // 합쳐진 rows + 메타
  const allRows: BuildingTitleInfo[] = [];
  let totalCountSum = 0;
  let anyCapped = false;
  for (const r of perBjd) {
    if (!r) continue;
    allRows.push(...r.rows);
    totalCountSum += r.totalCount;
    if (r.capped) anyCapped = true;
  }

  return {
    rows: allRows,
    perBjd,
    totalCountSum,
    anyCapped,
  };
}

/** 캐시 초기화 (보통 호출 X — 건물 데이터는 거의 안 변함) */
export function clearBuildingsCache(): void {
  buildingsByPnuCache.clear();
  buildingPolygonsByPnuCache.clear();
  buildingsByBjdCache.clear();
  fetchAllByBjdCache.clear();
  facilitySearchCache.clear();
}

// ────────────────────────────────────────────────────────────
//  필지(시설) atomic — /api/facility/search
//  공매·경매 search 패턴 미러. 좌표 박힌 결과를 한방에 받음.
// ────────────────────────────────────────────────────────────

import type { FacilityListItem } from "@/lib/facility/enrich";

interface FacilitySearchApiResponse {
  ok: boolean;
  items?: FacilityListItem[];
  totalCount?: number;
  capped?: boolean;
  fetchedAt?: string;
  error?: string;
}

export interface FetchFacilitySearchResult {
  items: FacilityListItem[];
  totalCount: number;
  capped: boolean;
}

/** key = bjdCodes 정렬+조인. 같은 조합 재호출 0회 fetch (sessionStorage 와 별도 메모리 캐시) */
const facilitySearchCache = new Map<string, FetchFacilitySearchResult>();

/**
 * /api/facility/search — 시설 모드 atomic.
 *
 * categories 는 빈 셋(전체) 가 기본 — 카테고리 토글은 클라이언트 useMemo 가 즉시 재필터링.
 * min_pyeong 도 0 이 기본 (클라이언트 필터). 서버 호출은 BJD 코드 조합만 변하면 충분.
 */
export async function fetchFacilitySearch(
  bjdCodes: string[],
  options?: FetchOptions,
): Promise<FetchFacilitySearchResult> {
  const sorted = [...bjdCodes].sort();
  const cacheKey = sorted.join(",");
  const cached = facilitySearchCache.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    bjd_codes: sorted.join(","),
  });
  const res = await fetch(`/api/facility/search?${params.toString()}`, {
    cache: "default",
    signal: options?.signal,
  });
  if (!res.ok) throw new Error(`facility/search HTTP ${res.status}`);
  const data = (await res.json()) as FacilitySearchApiResponse;
  if (!data.ok) throw new Error(data.error ?? "facility/search 오류");

  const result: FetchFacilitySearchResult = {
    items: data.items ?? [],
    totalCount: data.totalCount ?? 0,
    capped: !!data.capped,
  };
  facilitySearchCache.set(cacheKey, result);
  return result;
}

export type { BuildingTitleInfo, BuildingPolygon };
