/**
 * 캠코 온비드 부동산 OpenAPI 클라이언트.
 *
 * 검증된 엔드포인트 (crawler/test_onbid_filter*.py 2026-04-28~29):
 *   - 목록: getRlstCltrList2 (시도/시군구/면적/감정가/입찰일 필터 작동)
 *   - 상세: getRlstDtlInf2 (사진 URL onbid.co.kr 공식)
 *
 * 인증:
 *   - 환경변수 DATA_GO_KR_KEY (decoding 형태, /api 라우트 안에서 인코딩하여 전달)
 *
 * 주의:
 *   - cltrUsgSclsCtgrId 필터는 단일 코드만 (다중 매핑 카테고리는 응답 후필터)
 *   - 응답 items 가 1건일 때 객체 1개로 반환 (배열 아님) — normalizeItems 가 처리
 */

const LIST_ENDPOINT =
  "https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2";

/** 한 번에 받을 페이지 크기 — 캠코는 numOfRows 100 까지 안전 */
const PAGE_SIZE = 100;

export interface OnbidListRawParams {
  pageNo: number;
  numOfRows: number;
  /** 재산유형 (압류재산=0007 디폴트) */
  prptDivCd: string;
  /** 수의계약 가능 여부 (Y/N) */
  pvctTrgtYn: "Y" | "N";
  /** 시도 (예: "전라남도") — 빈 문자열이면 전국 */
  lctnSdnm?: string;
  /** 시군구 (예: "나주시") */
  lctnSggnm?: string;
  /** 읍면동 (예: "동강면") */
  lctnEmdNm?: string;
  /** 용도 대분류 (10000=부동산) */
  cltrUsgLclsCtgrId?: string;
  /** 용도 소분류 (예: 10402=창고시설) */
  cltrUsgSclsCtgrId?: string;
  /** 토지면적 ㎡ 범위 */
  landSqmsStart?: number;
  landSqmsEnd?: number;
  /** 건물면적 ㎡ 범위 */
  bldSqmsStart?: number;
  bldSqmsEnd?: number;
  /** 감정가 원 범위 */
  apslEvlAmtStart?: number;
  apslEvlAmtEnd?: number;
  /** 입찰기간 YYYYMMDD */
  bidPrdYmdStart?: string;
  bidPrdYmdEnd?: string;
  /** 유찰횟수 범위 */
  usbdNftStart?: number;
  usbdNftEnd?: number;
}

/** 캠코 raw 응답 1건 — 명세 기준 주요 필드만 (필요 시 확장) */
export interface OnbidRawListItem {
  cltrMngNo: string;
  pbctCdtnNo: number;
  onbidCltrno: number;
  onbidPbancNo: number;
  pbctNo: number;
  prptDivCd: string;
  prptDivNm: string;
  cltrUsgLclsCtgrId: string;
  cltrUsgMclsCtgrId: string;
  cltrUsgSclsCtgrId: string;
  cltrUsgLclsCtgrNm: string;
  cltrUsgMclsCtgrNm: string;
  cltrUsgSclsCtgrNm: string;
  onbidCltrNm: string;
  usbdNft: number | null;
  cltrBidBgngDt: string;
  cltrBidEndDt: string;
  apslEvlAmt: number;
  lowstBidPrcIndctCont: string;
  ltnoPnu: string;
  rdnmPnu: string;
  lctnSdnm: string;
  lctnSggnm: string;
  lctnEmdNm: string;
  landSqms: number | null;
  bldSqms: number | null;
  thnlImgUrlAdr?: string | null;
  pbctStatCd?: string;
  pbctStatNm?: string;
}

export interface OnbidRawListResponse {
  totalCount: number;
  pageNo: number;
  numOfRows: number;
  items: OnbidRawListItem[];
}

/**
 * 캠코 목록 조회 — 1 페이지.
 * resultCode != "00" 이면 throw.
 * items 가 0건이면 빈 배열, 1건이면 객체→배열로 정규화.
 */
export async function fetchOnbidListPage(
  params: OnbidListRawParams,
  options?: { signal?: AbortSignal },
): Promise<OnbidRawListResponse> {
  const apiKey = process.env.DATA_GO_KR_KEY;
  if (!apiKey) {
    throw new Error("DATA_GO_KR_KEY 환경변수 미설정");
  }

  const url = new URL(LIST_ENDPOINT);
  url.searchParams.set("serviceKey", apiKey);
  url.searchParams.set("resultType", "json");
  url.searchParams.set("pageNo", String(params.pageNo));
  url.searchParams.set("numOfRows", String(params.numOfRows));
  url.searchParams.set("prptDivCd", params.prptDivCd);
  url.searchParams.set("pvctTrgtYn", params.pvctTrgtYn);

  const optional: (keyof OnbidListRawParams)[] = [
    "lctnSdnm",
    "lctnSggnm",
    "lctnEmdNm",
    "cltrUsgLclsCtgrId",
    "cltrUsgSclsCtgrId",
    "landSqmsStart",
    "landSqmsEnd",
    "bldSqmsStart",
    "bldSqmsEnd",
    "apslEvlAmtStart",
    "apslEvlAmtEnd",
    "bidPrdYmdStart",
    "bidPrdYmdEnd",
    "usbdNftStart",
    "usbdNftEnd",
  ];
  for (const k of optional) {
    const v = params[k];
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), { signal: options?.signal });
  if (!res.ok) {
    throw new Error(`캠코 응답 HTTP ${res.status}`);
  }
  const text = await res.text();
  if (!text.trimStart().startsWith("{")) {
    throw new Error(`캠코 응답 JSON 아님: ${text.slice(0, 200)}`);
  }
  const json = JSON.parse(text) as {
    header?: { resultCode?: string; resultMsg?: string };
    body?: {
      totalCount?: number;
      pageNo?: number;
      numOfRows?: number;
      items?: { item?: OnbidRawListItem | OnbidRawListItem[] } | string;
    };
  };

  const code = json.header?.resultCode;
  if (code !== "00") {
    throw new Error(
      `캠코 resultCode=${code} msg=${json.header?.resultMsg ?? ""}`,
    );
  }

  const body = json.body ?? {};
  return {
    totalCount: body.totalCount ?? 0,
    pageNo: body.pageNo ?? params.pageNo,
    numOfRows: body.numOfRows ?? params.numOfRows,
    items: normalizeItems(body.items),
  };
}

/** 페이지 크기 상수 (외부에서 페이지네이션 결정 시 참고) */
export const ONBID_LIST_PAGE_SIZE = PAGE_SIZE;

function normalizeItems(
  items:
    | { item?: OnbidRawListItem | OnbidRawListItem[] }
    | string
    | undefined,
): OnbidRawListItem[] {
  if (!items || typeof items === "string") return [];
  const inner = items.item;
  if (!inner) return [];
  if (Array.isArray(inner)) return inner;
  return [inner];
}
