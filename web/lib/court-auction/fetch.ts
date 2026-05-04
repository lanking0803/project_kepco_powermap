/**
 * 법원경매정보재공 (courtauction.go.kr) 직접 호출.
 *
 * 검증 (2026-05-04 실측, scripts/test_court_auction/):
 *   - 인증/쿠키/세션 불필요
 *   - 페이지 사이즈 50 max (60+ 거부)
 *   - bjd_code 5자리 prefix 그대로 입력 ([0:2]/[2:5])
 *   - 5초 간격 호출 시 차단 0
 *   - 응답 후 500ms 직렬화 운영 시 안전
 *
 * 안전 장치 (건축HUB 패턴 미러):
 *   - 모듈 전역 lastResponseAt → 응답 후 500ms 보장
 *   - WAF 키워드 감지 → 800ms+jitter 1회 재시도
 *   - 운영 거부 메시지 ("사용에 불편을 드려서") 도 차단 인식
 */

import type {
  CourtApiStatus,
  CourtDetailParams,
  CourtDetailResponse,
  CourtListPageResult,
  CourtListResponse,
  CourtRawDetailItem,
  CourtSearchParams,
} from "./types";

const ENDPOINT_LIST =
  "https://www.courtauction.go.kr/pgj/pgjsearch/searchControllerMain.on";
const ENDPOINT_DETAIL =
  "https://www.courtauction.go.kr/pgj/pgj15A/selectAuctnCsSrchRslt.on";
const REFERER =
  "https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml";

// 응답 후 직렬화 — 모듈 전역. 워커 N개 동시 호출해도 외부 API 입장 직렬.
const POST_RESPONSE_DELAY_MS = 500;
const RETRY_BLOCKED_DELAY_MS = 800;
let nextAvailableAt = 0;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** WAF/거부 페이지 감지 키워드. */
const BLOCK_KEYWORDS = [
  "Web firewall",
  "web firewall",
  "Detect time",
  "have been blocked",
  "사용에 불편을 드려서",
];

/** 응답 본문이 차단/거부 인지 감지. */
function detectBlocked(rawText: string): boolean {
  if (!rawText) return false;
  return BLOCK_KEYWORDS.some((kw) => rawText.includes(kw));
}

/** 목록/상세 공통 헤더 (제거 시 WAF 차단 확인됨). */
const COMMON_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "Content-Type": "application/json;charset=UTF-8",
  Origin: "https://www.courtauction.go.kr",
  Referer: REFERER,
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
};

/**
 * 직렬화 + 차단 감지 + 1회 재시도 fetch.
 * 본문 raw text 와 status 를 함께 반환 (호출부가 차단/JSON 분기).
 */
async function throttledFetch(
  url: string,
  body: unknown,
  extraHeaders: Record<string, string>,
): Promise<{ status: number; raw: string; blocked: boolean }> {
  const headers = { ...COMMON_HEADERS, ...extraHeaders };
  const payload = JSON.stringify(body);

  // 1차 호출 — 직렬화 대기
  const wait1 = nextAvailableAt - Date.now();
  if (wait1 > 0) await sleep(wait1);
  let res = await fetch(url, { method: "POST", headers, body: payload, cache: "no-store" });
  let raw = await res.text();
  nextAvailableAt = Date.now() + POST_RESPONSE_DELAY_MS;

  if (detectBlocked(raw)) {
    // 2차 재시도 — 800ms+jitter 후
    await sleep(RETRY_BLOCKED_DELAY_MS + Math.floor(Math.random() * 200));
    const wait2 = nextAvailableAt - Date.now();
    if (wait2 > 0) await sleep(wait2);
    res = await fetch(url, { method: "POST", headers, body: payload, cache: "no-store" });
    raw = await res.text();
    nextAvailableAt = Date.now() + POST_RESPONSE_DELAY_MS;
  }

  return {
    status: res.status,
    raw,
    blocked: detectBlocked(raw),
  };
}

// ─── 목록 호출 ─────────────────────────────────────────────

/**
 * 목록 1페이지 호출.
 *
 * 페이지네이션 패턴 (실측):
 *   - 1p: bfPageNo="", startRowNo="", totalCnt="", totalYn="Y"
 *   - 2p+: bfPageNo=N-1, startRowNo=(N-1)*pageSize+1, totalCnt=<1p 값>, totalYn="N", groupTotalCount=<1p 값>
 *
 * 호출자가 직접 페이지네이션 echo 값을 채워서 전달.
 */
export async function fetchCourtList(
  params: CourtSearchParams,
): Promise<CourtListPageResult> {
  const body = {
    dma_pageInfo: {
      pageNo: params.pageNo,
      pageSize: params.pageSize,
      bfPageNo: params.bfPageNo ?? "",
      startRowNo: params.startRowNo ?? "",
      totalCnt: params.totalCnt ?? "",
      totalYn: params.totalYn ?? "Y",
      groupTotalCount: params.groupTotalCount ?? "",
    },
    dma_srchGdsDtlSrchInfo: {
      // ── 고정값 (사용자 노출 X — UI 와 무관) ─────────────
      // 부동산 (Mvprp) 카테고리 고정
      mvprpRletDvsCd: "00031R",
      cortAuctnSrchCondCd: "0004601",
      // 물건상세검색 화면 ID (의뢰자 cURL 캡처와 동일)
      pgmId: "PGJ151F01",
      cortStDvs: "2",
      // 공고중소재지 항상 ON — 영업 의도: 입찰가능 매물만
      notifyLoc: "on",
      statNum: 1,
      // 사건번호/입찰구분/법원 — 빈값 (전체)
      csNo: "",
      bidDvsCd: "",
      cortOfcCd: "",
      jdbnCd: "",
      execrOfcDvsCd: "",
      cortAuctnMbrsId: "",

      // ── 지역 ────────────────────────────────────────
      rprsAdongSdCd: params.sdCd,
      rprsAdongSggCd: params.sggCd,
      rprsAdongEmdCd: params.emdCd ?? "",

      // ── 용도 (단일 코드, 다중은 sweep 으로 분리 호출) ─
      lclDspslGdsLstUsgCd: params.lclCd ?? "",
      mclDspslGdsLstUsgCd: params.mclCd ?? "",
      sclDspslGdsLstUsgCd: params.sclCd ?? "",

      // ── 매각기일 ────────────────────────────────────
      bidBgngYmd: params.bidBgngYmd ?? "",
      bidEndYmd: params.bidEndYmd ?? "",
      dspslDxdyYmd: "",
      fstDspslHm: "",
      scndDspslHm: "",
      thrdDspslHm: "",
      fothDspslHm: "",

      // ── 가격 ────────────────────────────────────────
      aeeEvlAmtMin: params.aeeEvlAmtMin ?? "",
      aeeEvlAmtMax: params.aeeEvlAmtMax ?? "",
      lwsDspslPrcMin: params.lwsDspslPrcMin ?? "",
      lwsDspslPrcMax: params.lwsDspslPrcMax ?? "",
      lwsDspslPrcRateMin: params.lwsDspslPrcRateMin ?? "",
      lwsDspslPrcRateMax: params.lwsDspslPrcRateMax ?? "",

      // ── 면적 / 유찰 ────────────────────────────────
      objctArDtsMin: params.objctArDtsMin ?? "",
      objctArDtsMax: params.objctArDtsMax ?? "",
      flbdNcntMin: params.flbdNcntMin ?? "",
      flbdNcntMax: params.flbdNcntMax ?? "",

      // ── 특이사항 ───────────────────────────────────
      rletDspslSpcCondCd: params.rletDspslSpcCondCd ?? "",

      // ── 정렬 (옵션) ────────────────────────────────
      lafjOrderBy: params.orderBy ?? "",

      // ── 도로명/그 외 빈값 (서버 expect — 캡쳐 패턴 보존) ─
      rdnmSdCd: "",
      rdnmSggCd: "",
      rdnmNo: "",
      mvprpDspslPlcAdongSdCd: "",
      mvprpDspslPlcAdongSggCd: "",
      mvprpDspslPlcAdongEmdCd: "",
      rdDspslPlcAdongSdCd: "",
      rdDspslPlcAdongSggCd: "",
      rdDspslPlcAdongEmdCd: "",
      mvprpArtclKndCd: "",
      mvprpArtclNm: "",
      mvprpAtchmPlcTypCd: "",
      dspslPlcNm: "",
      grbxTypCd: "",
      gdsVendNm: "",
      fuelKndCd: "",
      carMdyrMax: "",
      carMdyrMin: "",
      carMdlNm: "",
      sideDvsCd: "",
    },
  };

  const { status, raw, blocked } = await throttledFetch(ENDPOINT_LIST, body, {
    "SC-Pgmid": "PGJ151F02",
    submissionid: "mf_wfm_mainFrame_sbm_selectGdsDtlSrch",
  });

  if (blocked) {
    return makeBlockedResult(params.pageNo, params.pageSize);
  }

  let parsed: CourtListResponse | null = null;
  try {
    parsed = JSON.parse(raw) as CourtListResponse;
  } catch {
    return {
      apiStatus: "unavailable",
      errMsg: `JSON 파싱 실패 (HTTP ${status})`,
      items: [],
      pageNo: params.pageNo,
      pageSize: params.pageSize,
      totalCnt: 0,
      groupTotalCount: 0,
      hasMore: false,
    };
  }

  const items = parsed?.data?.dlt_srchResult ?? [];
  const totalCnt = Number(parsed?.data?.dma_pageInfo?.totalCnt ?? 0);
  const groupTotalCount = Number(parsed?.data?.dma_pageInfo?.groupTotalCount ?? 0);

  if (status !== 200 || !parsed?.data) {
    return {
      apiStatus: "unavailable",
      errMsg: parsed?.message || `HTTP ${status}`,
      items: [],
      pageNo: params.pageNo,
      pageSize: params.pageSize,
      totalCnt: 0,
      groupTotalCount: 0,
      hasMore: false,
    };
  }

  const apiStatus: CourtApiStatus = items.length === 0 ? "empty" : "ok";
  const hasMore = totalCnt > params.pageNo * params.pageSize;

  return {
    apiStatus,
    items,
    pageNo: params.pageNo,
    pageSize: params.pageSize,
    totalCnt,
    groupTotalCount,
    hasMore,
  };
}

// ─── 상세 호출 ─────────────────────────────────────────────

/**
 * 사건 1건 상세 조회.
 *
 * 응답 12개 섹션 (사건기본/물건/목록/기일/당사자/배당요구/항고/관련사건/중복).
 */
export async function fetchCourtDetail(
  params: CourtDetailParams,
): Promise<{ apiStatus: CourtApiStatus; data: CourtRawDetailItem | null; errMsg?: string }> {
  const body = {
    dma_srchCsDtlInf: {
      cortOfcCd: params.cortOfcCd,
      csNo: params.csNo,
    },
  };

  const { status, raw, blocked } = await throttledFetch(ENDPOINT_DETAIL, body, {
    "SC-Pgmid": "PGJ15AF01",
    submissionid: "mf_wfm_mainFrame_sbm_selectCsDtlInf",
  });

  if (blocked) {
    return { apiStatus: "blocked", data: null, errMsg: "법원경매 사이트 일시 차단 — 잠시 후 재시도" };
  }

  let parsed: CourtDetailResponse | null = null;
  try {
    parsed = JSON.parse(raw) as CourtDetailResponse;
  } catch {
    return {
      apiStatus: "unavailable",
      data: null,
      errMsg: `JSON 파싱 실패 (HTTP ${status})`,
    };
  }

  if (status !== 200 || !parsed?.data) {
    return {
      apiStatus: "unavailable",
      data: null,
      errMsg: parsed?.message || `HTTP ${status}`,
    };
  }

  return { apiStatus: "ok", data: parsed.data };
}

// ─── 헬퍼 ─────────────────────────────────────────────────

function makeBlockedResult(pageNo: number, pageSize: number): CourtListPageResult {
  return {
    apiStatus: "blocked",
    errMsg: "법원경매 사이트 일시 차단 — 잠시 후 재시도",
    items: [],
    pageNo,
    pageSize,
    totalCnt: 0,
    groupTotalCount: 0,
    hasMore: false,
  };
}

/** 페이지네이션 헬퍼 — 다음 페이지 호출용 echo 파라미터 생성. */
export function buildNextPageParams(
  prev: CourtListPageResult,
  base: Omit<
    CourtSearchParams,
    "pageNo" | "bfPageNo" | "startRowNo" | "totalCnt" | "totalYn" | "groupTotalCount"
  >,
): CourtSearchParams {
  const nextPageNo = prev.pageNo + 1;
  return {
    ...base,
    pageNo: nextPageNo,
    bfPageNo: prev.pageNo,
    startRowNo: (prev.pageNo - 1) * prev.pageSize + 1,
    totalCnt: String(prev.totalCnt),
    totalYn: "N",
    groupTotalCount: prev.groupTotalCount,
  };
}
