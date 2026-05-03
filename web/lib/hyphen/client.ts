/**
 * Hyphen 부동산 법원경매 정보(경매다) API 클라이언트.
 *
 * 검증된 엔드포인트 (crawler/test_hyphen_v1~v4.py 2026-05-02):
 *   - 진행물건검색: POST /au0147001252 (페이지당 10건, dong 필터=면 단위)
 *   - 사건상세보기: POST /au0147001254 (product_id = 응답의 경매번호)
 *
 * 인증 (4헤더 모두 필수):
 *   - Hkey: HYPHEN_HKEY 환경변수
 *   - User-Id: HYPHEN_USER_ID 환경변수
 *   - Hyphen-Gustation: "Y" (테스트 모드, 운영 모드는 미정 — Hyphen 안내 시 갱신)
 *   - Content-Type: application/json
 *
 * 데이터 획득 제한 (의뢰자 결정 2026-05-02):
 *   1. 면(dong) 단위까지만 — by-pnu/route.ts 가 강제
 *   2. 최대 20페이지 (= 200건) cap
 *
 * errCd 분류 (UI 상태 배너용):
 *   - 200: 정상
 *   - 407: 매물 0건 (정상)
 *   - HDM006: UserId/Hkey 인증 실패 (결제 만료 가능성)
 *   - HDM016: 레이트리밋 (테스트 모드 20초 제한)
 *   - 미확인: insufficient_balance, expired (운영 호출 시 확인 예정)
 */

import {
  HYPHEN_ERR_CD_MAP,
  type AuctionListPageResult,
  type AuctionRawDetailItem,
  type AuctionRawListBody,
  type AuctionRawListItem,
  type AuctionSearchParams,
  type HyphenApiStatus,
  type HyphenResponse,
} from "./types";

const BASE = "https://api.hyphen.im";
const SEARCH_PATH = "/au0147001252";
const DETAIL_PATH = "/au0147001254";

/** 면 sweep 시 한 PNU 호출당 받는 페이지 수 상한. */
export const HYPHEN_MAX_PAGES = 20;

/**
 * 인증 헤더 생성.
 *
 * ⚠️ Hyphen-Gustation 헤더 동작 (실호출 검증):
 *   - "Y" 부착 = 테스트 모드 (20초 레이트리밋, 비즈머니 차감 X)
 *   - 헤더 미부착 = 운영 모드 (비즈머니 차감 + 별도 권한 필요)
 *     → 별도 신청 안 한 계정은 errCd=HDM012 ("권한이 없는 API 입니다") 응답
 *
 * 현재 정책: 의뢰자가 운영 모드 권한 확보 전까지 **테스트 모드 기본값**.
 * 운영 모드 권한 확보 후엔 환경변수 `HYPHEN_OPERATION_MODE=Y` 로 토글.
 */
function authHeaders(): Record<string, string> {
  const hkey = process.env.HYPHEN_HKEY;
  const userId = process.env.HYPHEN_USER_ID;
  if (!hkey || !userId) {
    throw new Error("HYPHEN_HKEY / HYPHEN_USER_ID 환경변수 미설정");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Hkey: hkey,
    "User-Id": userId,
  };
  // 운영 모드 명시 토글 안 했으면 기본 = 테스트 모드 (HDM012 회피)
  if (process.env.HYPHEN_OPERATION_MODE !== "Y") {
    headers["Hyphen-Gustation"] = "Y";
  }
  return headers;
}

/** errCd → apiStatus 매핑. 미등록 errCd 는 unavailable. */
function classifyStatus(errYn: string, errCd: string): HyphenApiStatus {
  if (errYn === "N") return HYPHEN_ERR_CD_MAP[errCd] ?? "ok";
  return HYPHEN_ERR_CD_MAP[errCd] ?? "unavailable";
}

/** 진행물건검색 — 1페이지 호출. 비정상이어도 throw 하지 않고 apiStatus 로 표현. */
export async function fetchAuctionListPage(
  params: AuctionSearchParams,
  options?: { signal?: AbortSignal },
): Promise<AuctionListPageResult> {
  const headers = authHeaders();
  let res: Response;
  try {
    res = await fetch(`${BASE}${SEARCH_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify(params),
      signal: options?.signal,
      cache: "no-store",
    });
  } catch (e) {
    // 네트워크 장애
    return {
      apiStatus: "unavailable",
      errCd: "NET_ERROR",
      errMsg: e instanceof Error ? e.message : String(e),
      items: [],
      nowpage: 0,
      totallist: 0,
      totalpage: 0,
    };
  }

  if (!res.ok) {
    return {
      apiStatus: "unavailable",
      errCd: `HTTP_${res.status}`,
      errMsg: `Hyphen 응답 HTTP ${res.status}`,
      items: [],
      nowpage: 0,
      totallist: 0,
      totalpage: 0,
    };
  }

  const json = (await res.json()) as HyphenResponse<AuctionRawListBody>;
  const apiStatus = classifyStatus(json.common.errYn, json.common.errCd);

  if (apiStatus !== "ok") {
    return {
      apiStatus,
      errCd: json.common.errCd,
      errMsg: json.common.errMsg,
      items: [],
      nowpage: 0,
      totallist: 0,
      totalpage: 0,
    };
  }

  const body = json.data;
  return {
    apiStatus: "ok",
    errCd: json.common.errCd,
    errMsg: json.common.errMsg,
    items: body?.data ?? [],
    nowpage: parseInt(body?.nowpage ?? "1", 10) || 1,
    totallist: parseInt(body?.totallist ?? "0", 10) || 0,
    totalpage: parseInt(body?.totalpage ?? "1", 10) || 1,
  };
}

/**
 * 면 단위 sweep — page 1 호출 후 totalpage 만큼 병렬 호출.
 * 20페이지 cap 적용 (= 최대 200건). Cap 초과 시 응답 객체에 truncated 표시.
 *
 * 첫 페이지가 비정상(apiStatus !== "ok") 이면 즉시 그 status 반환.
 *
 * ⚠️ 테스트 모드(HYPHEN_OPERATION_MODE !== 'Y')에선 page 1 만 호출.
 *    Hyphen 테스트 모드는 호출 간격 20초 강제 — 병렬 sweep 시 page 2~N 전부
 *    HDM016 으로 실패해 로그만 더럽힘. 페이지당 10건 고정이라 10건만 보이지만
 *    truncated=true 로 UI 가 안내. 운영 모드 전환 후 자동 풀 sweep.
 */
export interface AuctionVillageSweepResult {
  apiStatus: HyphenApiStatus;
  errCd: string;
  errMsg: string;
  /** 모든 페이지 매물 합본 (apiStatus="ok" 일 때만 채워짐) */
  items: AuctionRawListItem[];
  /** 첫 페이지의 totallist (서버가 알려준 면 전체 매물 수) */
  totallist: number;
  /** 실제 받은 페이지 수 (cap 적용 후) */
  pagesFetched: number;
  /** totalpage > HYPHEN_MAX_PAGES 라서 잘라낸 경우 true */
  truncated: boolean;
}

export async function fetchAuctionVillageSweep(
  baseParams: Omit<AuctionSearchParams, "page">,
  options?: { signal?: AbortSignal },
): Promise<AuctionVillageSweepResult> {
  const page1 = await fetchAuctionListPage(
    { ...baseParams, page: "1" },
    options,
  );

  if (page1.apiStatus !== "ok") {
    return {
      apiStatus: page1.apiStatus,
      errCd: page1.errCd,
      errMsg: page1.errMsg,
      items: [],
      totallist: 0,
      pagesFetched: 1,
      truncated: false,
    };
  }

  const totalpage = Math.max(1, page1.totalpage);
  const isOperationMode = process.env.HYPHEN_OPERATION_MODE === "Y";
  // 테스트 모드: page 1 만 (병렬 호출 시 20초 레이트리밋으로 전부 실패).
  // 운영 모드: 20페이지 cap 까지 병렬.
  const cappedTotal = isOperationMode
    ? Math.min(totalpage, HYPHEN_MAX_PAGES)
    : 1;
  const truncated = isOperationMode
    ? totalpage > HYPHEN_MAX_PAGES
    : totalpage > 1;

  if (cappedTotal === 1) {
    return {
      apiStatus: "ok",
      errCd: page1.errCd,
      errMsg: page1.errMsg,
      items: page1.items,
      totallist: page1.totallist,
      pagesFetched: 1,
      truncated,
    };
  }

  // page 2 ~ cappedTotal 병렬 호출 (운영 모드에서만 도달)
  const restPageNumbers = Array.from(
    { length: cappedTotal - 1 },
    (_, i) => i + 2,
  );
  const restResults = await Promise.all(
    restPageNumbers.map((p) =>
      fetchAuctionListPage({ ...baseParams, page: String(p) }, options),
    ),
  );

  const items: AuctionRawListItem[] = [...page1.items];
  let pagesFetched = 1;
  for (const r of restResults) {
    pagesFetched += 1;
    if (r.apiStatus === "ok") {
      items.push(...r.items);
    } else {
      // 일부 페이지 실패해도 첫 페이지가 ok 면 계속 — 부분 응답 허용.
      // 다만 같은 인증/잔액 문제는 여기서도 잡힐 수 있어 errCd 만 로깅.
      console.warn(
        `[hyphen/sweep] 페이지 일부 실패 errCd=${r.errCd} msg=${r.errMsg}`,
      );
    }
  }

  return {
    apiStatus: "ok",
    errCd: page1.errCd,
    errMsg: page1.errMsg,
    items,
    totallist: page1.totallist,
    pagesFetched,
    truncated,
  };
}

/**
 * 경매사건상세보기 — product_id (= 응답의 경매번호) 로 단건 조회.
 * 검증 v2-4: 1004029 (월곶면 고막리 144-11) → 45필드 응답.
 */
export interface AuctionDetailResult {
  apiStatus: HyphenApiStatus;
  errCd: string;
  errMsg: string;
  detail: AuctionRawDetailItem | null;
}

export async function fetchAuctionDetail(
  productId: string | number,
  options?: { signal?: AbortSignal },
): Promise<AuctionDetailResult> {
  const headers = authHeaders();
  let res: Response;
  try {
    res = await fetch(`${BASE}${DETAIL_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ product_id: String(productId) }),
      signal: options?.signal,
      cache: "no-store",
    });
  } catch (e) {
    return {
      apiStatus: "unavailable",
      errCd: "NET_ERROR",
      errMsg: e instanceof Error ? e.message : String(e),
      detail: null,
    };
  }
  if (!res.ok) {
    return {
      apiStatus: "unavailable",
      errCd: `HTTP_${res.status}`,
      errMsg: `Hyphen 응답 HTTP ${res.status}`,
      detail: null,
    };
  }

  const json = (await res.json()) as HyphenResponse<{
    success: string;
    data: AuctionRawDetailItem;
  }>;
  const apiStatus = classifyStatus(json.common.errYn, json.common.errCd);

  if (apiStatus !== "ok") {
    return {
      apiStatus,
      errCd: json.common.errCd,
      errMsg: json.common.errMsg,
      detail: null,
    };
  }

  return {
    apiStatus: "ok",
    errCd: json.common.errCd,
    errMsg: json.common.errMsg,
    detail: json.data?.data ?? null,
  };
}

/** 헬스체크용 가벼운 호출 — 시도코드조회 (au0147001246, body 없음). */
export async function fetchAuctionHealthcheck(): Promise<{
  apiStatus: HyphenApiStatus;
  errCd: string;
  errMsg: string;
}> {
  const headers = authHeaders();
  try {
    const res = await fetch(`${BASE}/au0147001246`, {
      method: "POST",
      headers,
      body: "{}",
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        apiStatus: "unavailable",
        errCd: `HTTP_${res.status}`,
        errMsg: `Hyphen 응답 HTTP ${res.status}`,
      };
    }
    const json = (await res.json()) as HyphenResponse<unknown>;
    return {
      apiStatus: classifyStatus(json.common.errYn, json.common.errCd),
      errCd: json.common.errCd,
      errMsg: json.common.errMsg,
    };
  } catch (e) {
    return {
      apiStatus: "unavailable",
      errCd: "NET_ERROR",
      errMsg: e instanceof Error ? e.message : String(e),
    };
  }
}
