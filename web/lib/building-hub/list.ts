/**
 * 건축HUB 표제부 (getBrTitleInfo) 일괄 조회 — 법정동 1개 단위.
 *
 * `lib/building-hub/title.ts` 의 단건(getBuildingTitleByPnu) 과 동일 endpoint 를
 * 사용하지만 호출 방식이 다르다:
 *   - 단건: sigunguCd + bjdongCd + bun + ji 모두 지정 → 그 지번 위 건물 N개
 *   - 일괄: sigunguCd + bjdongCd 만 지정 (bun/ji 생략) → 그 법정동 안 모든 건물
 *
 * 검증 (2026-05-03 실측):
 *   - bjdongCd 빈값/생략 = totalCount=0 (시군구만으로 조회 불가)
 *   - 강남구 역삼동(1168010100) totalCount=4,957건 — 페이지네이션 필수
 *   - resultCode "00" = NORMAL_SERVICE, "03" = NODATA(0건도 정상)
 *
 * 한도:
 *   - 10,000 호출/일 (운영계정)
 *   - **numOfRows 는 외부 API 가 100 hard cap** (요청 500/1000 무시, 무조건 100 응답
 *     — 2026-05-03 실측). 페이지 순회 필수.
 *   - 시설 모드 적재 시 영업 권역 시도 단위로 분할 적재 권장
 *
 * 페이지네이션:
 *   - atomic endpoint 는 1페이지만 응답 (자동 순회 X)
 *   - 자동 순회는 적재 스크립트가 담당
 */
import {
  type BrTitleItem,
  type BuildingTitleInfo,
  normalize,
} from "./title";

const ENDPOINT =
  "https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo";
const KEY = process.env.DATA_GO_KR_KEY || "";

// 게이트웨이 burst 한도 회피: 응답 회신 후 무조건 500ms 대기 (모듈 전역 직렬화).
// 워커 5개가 동시에 호출해도 외부에서 보면 2건/s 로 흘러나감.
// 멀티 인스턴스 동시 사용자 5명까지 burst 한도(~10건/s) 안쪽 안전 (2026-05-03 의뢰자 합의).
const POST_RESPONSE_DELAY_MS = 500;
const RETRY_429_DELAY_MS = 800;
let nextAvailableAt = 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function throttledFetch(url: string): Promise<Response> {
  const wait = nextAvailableAt - Date.now();
  if (wait > 0) await sleep(wait);
  const res = await fetch(url, { cache: "no-store" });
  nextAvailableAt = Date.now() + POST_RESPONSE_DELAY_MS;
  return res;
}

export interface ListBuildingsOptions {
  /** 페이지 번호 (1-base, 기본 1) */
  pageNo?: number;
  /** 페이지당 행수 (기본 100). 외부 API 가 100 hard cap — 더 큰 값 무시됨. */
  numOfRows?: number;
}

export interface ListBuildingsResult {
  /** 입력 bjdCode (10자리) */
  bjdCode: string;
  pageNo: number;
  numOfRows: number;
  /** 조건 매치 전체 건수 (서버 응답) */
  totalCount: number;
  /** 다음 페이지 존재 여부 */
  hasMore: boolean;
  rows: BuildingTitleInfo[];
}

interface BrTitleListResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: {
      items?: { item?: BrTitleItem | BrTitleItem[] } | string;
      numOfRows?: string | number;
      pageNo?: string | number;
      totalCount?: string | number;
    };
  };
}

/**
 * 법정동 단위 일괄 조회 (단일 페이지).
 *
 * @param bjdCode 10자리 법정동 코드 (시군구5 + 동5)
 * @param opts pageNo / numOfRows
 */
export async function listBuildingsByBjd(
  bjdCode: string,
  opts: ListBuildingsOptions = {},
): Promise<ListBuildingsResult> {
  if (!KEY) throw new Error("DATA_GO_KR_KEY 환경변수가 등록되지 않았습니다.");
  if (!/^\d{10}$/.test(bjdCode)) {
    throw new Error("bjdCode 는 10자리 숫자여야 합니다.");
  }

  const sigunguCd = bjdCode.slice(0, 5);
  const bjdongCd = bjdCode.slice(5, 10);
  const pageNo = Math.max(1, Math.floor(opts.pageNo ?? 1));
  // 외부 API 가 100 hard cap (실측 2026-05-03). 큰 값 보내봐야 무시됨.
  const numOfRows = Math.min(100, Math.max(1, Math.floor(opts.numOfRows ?? 100)));

  const params = new URLSearchParams({
    serviceKey: KEY,
    sigunguCd,
    bjdongCd,
    _type: "json",
    numOfRows: String(numOfRows),
    pageNo: String(pageNo),
  });

  const url = `${ENDPOINT}?${params.toString()}`;
  let res = await throttledFetch(url);
  if (res.status === 429) {
    // 429 = burst 한도 차단. 800ms + jitter 대기 후 1회만 재시도.
    await sleep(RETRY_429_DELAY_MS + Math.floor(Math.random() * 200));
    res = await throttledFetch(url);
  }
  if (!res.ok) throw new Error(`건축HUB HTTP ${res.status}`);

  const data = (await res.json()) as BrTitleListResponse;
  const code = data.response?.header?.resultCode;
  // "00" 정상, "03" NODATA(0건) — 둘 다 정상 처리. 그 외는 에러.
  if (code && code !== "00" && code !== "03") {
    throw new Error(
      `건축HUB ${code}: ${data.response?.header?.resultMsg ?? ""}`,
    );
  }

  const total = num(data.response?.body?.totalCount);
  const items = data.response?.body?.items;
  let rows: BuildingTitleInfo[] = [];
  if (items && typeof items === "object") {
    const raw = items.item;
    if (raw) {
      const arr: BrTitleItem[] = Array.isArray(raw) ? raw : [raw];
      rows = arr.map(normalize);
    }
  }

  return {
    bjdCode,
    pageNo,
    numOfRows,
    totalCount: total,
    hasMore: pageNo * numOfRows < total,
    rows,
  };
}

function num(v: string | number | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
