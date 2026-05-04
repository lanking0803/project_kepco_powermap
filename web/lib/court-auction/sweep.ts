/**
 * 법원경매 페이지 + 용도 코드 sweep.
 *
 * 두 가지 sweep 차원:
 *   1. 페이지 sweep — totalCnt 보고 cap 까지 직렬 호출 (echo 파라미터 필요)
 *   2. 용도 sweep — 다중 용도 코드 = 코드별 Sweep 직렬 (서로 다른 검색이라 dedup)
 *
 * 동시성:
 *   - fetchCourtList 가 모듈 전역 throttle (응답 후 500ms) 박혀 있어 병렬 불가능 (어차피 직렬)
 *   - 단순 직렬 호출로 충분
 *
 * dedup 키: docid (매물 unique ID)
 *
 * 페이지 cap: 20 (hyphen 과 동일). 의뢰자 영업 의도 = 시군구 단위 = 보통 < 1000건.
 */

import { buildNextPageParams, fetchCourtList } from "./fetch";
import type {
  CourtApiStatus,
  CourtRawListItem,
  CourtSearchParams,
} from "./types";
import type { CourtUsageTriple } from "./usage-map";

/** 페이지 sweep 최대 페이지 (totalCnt 가 많아도 끊음). */
export const COURT_MAX_PAGES = 20;

/** 한 sweep 결과. */
export interface CourtSweepResult {
  apiStatus: CourtApiStatus;
  errMsg?: string;
  /** dedup 후 매물 union (docid 기준) */
  items: CourtRawListItem[];
  /** 호출별 totalCnt 합산 (sweep 합산 — 각 용도별 totalCnt 단순 합) */
  totalCntAll: number;
  /** 페이지 cap 또는 용도별 cap 으로 잘렸는지 */
  truncated: boolean;
  /** 실제 호출 페이지 수 (모든 sweep 합산) */
  pagesFetched: number;
}

/** sweep 입력 — 지역/용도 외 검색 조건 다 포함. */
export type CourtSweepParams = Omit<
  CourtSearchParams,
  "pageNo" | "bfPageNo" | "startRowNo" | "totalCnt" | "totalYn" | "groupTotalCount" | "lclCd" | "mclCd" | "sclCd"
>;

/**
 * 단일 용도 (또는 용도 미지정) 페이지 sweep.
 *
 * - 1p 호출 → totalCnt 기준 다음 페이지 cap 까지 직렬 호출
 * - 페이지 cap 초과 시 truncated=true
 */
async function sweepOnePages(
  base: CourtSweepParams,
  triple: CourtUsageTriple | null,
): Promise<CourtSweepResult> {
  const usageFields: Pick<CourtSearchParams, "lclCd" | "mclCd" | "sclCd"> = triple
    ? { lclCd: triple.lclCd, mclCd: triple.mclCd, sclCd: triple.sclCd }
    : { lclCd: "", mclCd: "", sclCd: "" };

  const page1 = await fetchCourtList({
    ...base,
    ...usageFields,
    pageNo: 1,
    pageSize: base.pageSize ?? 50,
    totalYn: "Y",
  });

  if (page1.apiStatus === "blocked" || page1.apiStatus === "unavailable") {
    return {
      apiStatus: page1.apiStatus,
      errMsg: page1.errMsg,
      items: [],
      totalCntAll: 0,
      truncated: false,
      pagesFetched: 1,
    };
  }

  if (page1.apiStatus === "empty") {
    return {
      apiStatus: "empty",
      items: [],
      totalCntAll: 0,
      truncated: false,
      pagesFetched: 1,
    };
  }

  const items: CourtRawListItem[] = [...page1.items];
  const totalPages = Math.max(1, Math.ceil(page1.totalCnt / page1.pageSize));
  const cappedTotal = Math.min(totalPages, COURT_MAX_PAGES);
  let truncated = totalPages > COURT_MAX_PAGES;
  let pagesFetched = 1;

  // 2p ~ cap 직렬 호출 (court 는 echo 필요해서 직렬만)
  let prev = page1;
  for (let p = 2; p <= cappedTotal; p++) {
    const nextParams = buildNextPageParams(prev, {
      ...base,
      ...usageFields,
      pageSize: page1.pageSize,
    });
    const result = await fetchCourtList(nextParams);
    pagesFetched += 1;

    if (result.apiStatus === "blocked" || result.apiStatus === "unavailable") {
      // 도중 차단 — 부분 결과 반환 + truncated 표시
      truncated = true;
      break;
    }
    if (result.items.length === 0) break;

    items.push(...result.items);
    prev = result;
  }

  return {
    apiStatus: "ok",
    items,
    totalCntAll: page1.totalCnt,
    truncated,
    pagesFetched,
  };
}

/**
 * 용도 코드 다중 sweep — 각 용도별 페이지 sweep 후 docid 기준 dedup.
 *
 * 입력:
 *   - triples 빈 배열 = 용도 미지정 단일 sweep
 *   - triples N개 = N회 sweep + dedup
 *
 * 결과:
 *   - apiStatus = 모든 sweep 중 첫 번째 비정상 또는 "ok"
 *   - totalCntAll = 각 sweep 의 totalCnt 단순 합 (참고치 — 실제 dedup 결과는 items.length)
 *   - truncated = 어느 한 sweep 이라도 잘렸으면 true
 */
export async function fetchCourtSweep(
  base: CourtSweepParams,
  triples: CourtUsageTriple[],
): Promise<CourtSweepResult> {
  // 빈 배열 = 용도 미지정 단일 sweep
  const sweepsToRun: (CourtUsageTriple | null)[] =
    triples.length === 0 ? [null] : triples;

  const dedup = new Map<string, CourtRawListItem>();
  let totalCntAll = 0;
  let truncated = false;
  let pagesFetched = 0;
  let firstBadStatus: CourtApiStatus | null = null;
  let firstBadMsg: string | undefined;

  for (const triple of sweepsToRun) {
    const r = await sweepOnePages(base, triple);
    pagesFetched += r.pagesFetched;

    if (r.apiStatus === "blocked" || r.apiStatus === "unavailable") {
      // 첫 비정상만 기록 — 다음 sweep 도 이어서 진행 (부분 결과라도 반환)
      if (!firstBadStatus) {
        firstBadStatus = r.apiStatus;
        firstBadMsg = r.errMsg;
      }
      continue;
    }

    totalCntAll += r.totalCntAll;
    truncated = truncated || r.truncated;

    for (const item of r.items) {
      const key = item.docid;
      if (!key || dedup.has(key)) continue;
      dedup.set(key, item);
    }
  }

  const items = Array.from(dedup.values());

  // 모든 sweep 비정상 + 결과 0건 = 실패 그대로 반환
  if (firstBadStatus && items.length === 0) {
    return {
      apiStatus: firstBadStatus,
      errMsg: firstBadMsg,
      items: [],
      totalCntAll: 0,
      truncated: false,
      pagesFetched,
    };
  }

  return {
    apiStatus: items.length === 0 ? "empty" : "ok",
    items,
    totalCntAll,
    truncated,
    pagesFetched,
  };
}
