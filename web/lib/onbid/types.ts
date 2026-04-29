/**
 * 캠코 온비드 공매 API 타입.
 *
 * 명세 + 실호출 검증 (2026-04-28~29 / crawler/test_onbid_filter*.py):
 *   - 목록: getRlstCltrList2 → ltnoPnu 19자리 100% 채움
 *   - 상세: getRlstDtlInf2 → potoUrlList = list (사진 URL onbid.co.kr 공식 도메인)
 *
 * 카테고리 필터: cltrUsgSclsCtgrId (소분류 코드, 예: 10402=창고시설) 작동 검증.
 * 시도/시군구/면적/감정가/입찰일정 필터 모두 작동 검증 통과.
 */

// ─── 우리 카테고리 5종 (의뢰자 명시) ─────────────
// 캠코 cltrUsgSclsCtgrId 코드와 매핑 → web/lib/onbid/categories.ts (Phase 1 작성)

export type OurCategory =
  | "토지"
  | "유리온실"
  | "축사"
  | "창고"
  | "건물50plus";

export const OUR_CATEGORY_LABEL: Record<OurCategory, string> = {
  토지: "토지",
  유리온실: "유리온실",
  축사: "축사",
  창고: "창고",
  건물50plus: "50평+ 건축물",
};

// ─── 검색 입력 (사이드바 → atomic endpoint → 캠코) ─────────────

export interface OnbidSearchParams {
  /** 시도 (예: "전라남도") — 캠코 lctnSdnm. 빈 문자열 = 전국 */
  sido: string;
  /** 시군구 (예: "나주시") — 캠코 lctnSggnm */
  sigungu: string;
  /** 읍면동 (예: "동강면") — 캠코 lctnEmdNm */
  emdong: string;
  /** 우리 카테고리 다중 선택. 빈 배열 = 전체 */
  categories: OurCategory[];
  /** 토지면적 ㎡ 범위. null = 제한 없음 */
  landMin: number | null;
  landMax: number | null;
  /** 감정가 원 범위. null = 제한 없음 */
  apslMin: number | null;
  apslMax: number | null;
  /** 입찰기간 시작/종료 (YYYY-MM-DD). null = 제한 없음 */
  bidStart: string | null;
  bidEnd: string | null;
  /** 유찰횟수 범위. null = 제한 없음 */
  usbdMin: number | null;
  usbdMax: number | null;
  /** 페이지네이션 */
  pageNo: number;
  numOfRows: number;
}

// ─── 목록 응답 1건 (캠코 raw 필드 그대로 + 우리 추가 필드) ─────────────

export interface OnbidListItem {
  // ── 캠코 응답 필드 (raw) ──
  /** 물건관리번호 — 상세 호출 키 */
  cltrMngNo: string;
  /** 공매조건번호 — 상세 호출 보조 키 */
  pbctCdtnNo: number | null;
  /** 온비드물건번호 — 외부 링크 키 후보 */
  onbidCltrno: number;
  /** 온비드공고번호 */
  onbidPbancNo: number;
  /** 공매번호 */
  pbctNo: number;
  /** 매물명 (보통 지번 텍스트 포함) */
  onbidCltrNm: string;
  /** 지번 PNU 19자리 */
  ltnoPnu: string;
  /** 도로명 PNU 25자리 */
  rdnmPnu: string;
  /** 소재지 시도 */
  lctnSdnm: string;
  /** 소재지 시군구 */
  lctnSggnm: string;
  /** 소재지 읍면동 */
  lctnEmdNm: string;
  /** 캠코 용도 대분류 코드 (10000=부동산) */
  cltrUsgLclsCtgrId: string;
  /** 캠코 용도 중분류 코드 */
  cltrUsgMclsCtgrId: string;
  /** 캠코 용도 소분류 코드 (예: 10402=창고시설) */
  cltrUsgSclsCtgrId: string;
  /** 용도 소분류 한글명 (예: "창고시설", "단독주택") */
  cltrUsgSclsCtgrNm: string;
  /** 재산유형 코드 (0007=압류재산 등) */
  prptDivCd: string;
  /** 재산유형 한글명 */
  prptDivNm: string;
  /** 감정평가금액 (원) */
  apslEvlAmt: number;
  /** 최저입찰가격 (문자열, 콤마 포함 가능) */
  lowstBidPrcIndctCont: string;
  /** 입찰 시작 일시 (YYYYMMDDHHmm) */
  cltrBidBgngDt: string;
  /** 입찰 종료 일시 (YYYYMMDDHHmm) */
  cltrBidEndDt: string;
  /** 토지면적 ㎡ */
  landSqms: number | null;
  /** 건물면적 ㎡ */
  bldSqms: number | null;
  /** 유찰횟수 */
  usbdNft: number | null;

  // ── 우리 추가 (atomic endpoint 가 enrich) ──
  /** 우리 카테고리 (cltrUsgSclsCtgrId 매핑 결과) */
  ourCategory: OurCategory | null;
  /** 동/리 좌표 (PNU 앞 10자리 → bjd_master JOIN 결과) */
  lat: number | null;
  lng: number | null;
  /** 최저입찰가 숫자 (lowstBidPrcIndctCont 파싱) */
  lowstBidPrc: number;
  /** 할인율 (감정가 대비, 0~1) */
  discountRatio: number;
  /** D-day (입찰종료일 - 오늘, 음수면 마감) */
  daysLeft: number;
  /** D-3 이내 임박 매물 여부 */
  isUrgent: boolean;
}

// ─── 상세 응답 (사진/면적상세/감정평가 등 부가 정보) ─────────────

export interface OnbidDetail extends OnbidListItem {
  /** 사진 URL 목록 (onbid.co.kr 공식 도메인) */
  photoUrls: string[];
  /** 공매재산명세 (Object[]) — 부가 정보 */
  papsInf: unknown[];
}

// ─── 검색 응답 ─────────────

export interface OnbidSearchResponse {
  /** 총 건수 (페이지네이션용) */
  totalCount: number;
  /** 현재 페이지 결과 */
  items: OnbidListItem[];
  /** 응답 시각 (캐시 디버깅) */
  fetchedAt: string;
}
