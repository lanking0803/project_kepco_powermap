/**
 * Hyphen 부동산 법원경매 정보(경매다) API 타입.
 *
 * 명세 + 실호출 검증 (2026-05-02 / crawler/test_hyphen_v1~v4.py):
 *   - 11개 엔드포인트: /au0147001244 ~ /au0147001254
 *   - 검색: /au0147001252 (진행물건검색) — page sweep 형식, 페이지당 10건
 *   - 상세: /au0147001254 (경매사건상세보기) — product_id (= 경매번호) 입력
 *   - 코드: /au0147001246 (시도) /au0147001247 (구군) /au0147001248 (동) /au0147001250 (용도)
 *
 * ⚠️ 명세서의 응답 필드명이 모두 "get○○" 으로 표기돼 있으나
 *    실제 응답 키에는 "get" 접두사가 **붙지 않음** (실호출 검증 결과).
 *    예) 명세 "get감정가" → 실응답 "감정가"
 *
 * ⚠️ 사건번호코드 ≠ product_id (검증 12 결과)
 *    상세 호출엔 응답의 `경매번호` 사용 (사건번호코드 X)
 *
 * 검증된 사실 (의도된 설계):
 *   - sido/gugun/dong = 행안부 표준 코드 (bjd_code 슬라이스 그대로 가능)
 *     · sido (2) = pnu[0:2]   (예: "41" 경기)
 *     · gugun (5) = pnu[0:5]  (예: "41570" 김포)
 *     · dong (10) = pnu[0:10] (예: "4157034033" 대명리 — 행안부 리 단위 코드)
 *   - dong 필터는 실제로는 "면(面) 단위" 매칭 (대명리 입력 → 같은 면 율생리도 응답에 옴)
 *   - 응답에 종결 매물(매각/취하 등)도 섞여 옴 — 진행상태 필드로 구분 후 표시
 */

// ─── 응답 wrapper 공통 ─────────────────────────────────────

export interface HyphenCommon {
  userTrNo: string | null;
  hyphenTrNo: string;
  errYn: "Y" | "N";
  errCd: string;
  errMsg: string;
}

export interface HyphenResponse<T> {
  common: HyphenCommon;
  data: T | null;
}

// ─── API 상태 (UX 분기용) ─────────────────────────────────

/** API 호출 결과 상태 — UI 배너/배지 결정용. */
export type HyphenApiStatus =
  /** 정상 응답 (errYn=N, 매물 있을 수도 0건일 수도) */
  | "ok"
  /** 매물 0건 — 정상 응답이지만 result data 가 비어있음 (errCd=407) */
  | "empty"
  /** 인증 실패 — UserId/Hkey 오류 또는 결제 만료로 키 무효화 (errCd=HDM006/HDM009) */
  | "auth_failed"
  /** 비즈머니 부족 — 결제 필요 (errCd 미확인, 운영 모드 시 발견 예정) */
  | "insufficient_balance"
  /** 운영 모드 사용권 없음 — Hyphen 측 별도 신청 필요 (errCd=HDM012) */
  | "no_permission"
  /** 레이트리밋 — 테스트 모드 20초 제한 (errCd=HDM016) */
  | "rate_limited"
  /** 일시 장애 — 5xx 또는 알 수 없는 errCd */
  | "unavailable";

/** errCd → 우리 status 매핑. 신규 errCd 발견되면 여기 추가.
 *  실호출 검증으로 확인된 errCd:
 *    - 200: 정상
 *    - 407: "상세내용이 없습니다" (정상 0건)
 *    - HDM006: "UserId 또는 HKey가 존재하지 않습니다" (헤더 누락)
 *    - HDM009: "UserId 또는 HKey가 올바르지 않습니다" (값 오류 — 변조/만료/오타)
 *    - HDM012: "권한이 없는 API 입니다" (운영 모드 사용권 없음 — 의뢰자가 Hyphen 측에 별도 신청 필요)
 *    - HDM016: "테스트 요청은 20초에 한 번만 가능" (Hyphen-Gustation: Y 부착 시)
 */
export const HYPHEN_ERR_CD_MAP: Record<string, HyphenApiStatus> = {
  "200": "ok",
  "407": "empty",
  HDM006: "auth_failed",
  HDM009: "auth_failed",
  HDM012: "no_permission",
  HDM016: "rate_limited",
};

// ─── 진행물건검색 (au0147001252) ────────────────────────────

/** 진행물건검색 입력 파라미터. 모두 string (Hyphen 명세 따름). */
export interface AuctionSearchParams {
  /** 페이지 번호 (생략 시 1) */
  page?: string;
  /** 용도코드 (au0147001250 응답의 용도코드 — 토지=33 임야=33 등 59종) */
  yongdo?: string;
  /** 법원코드 */
  court?: string;
  /** 소재지코드 */
  scode?: string;
  /** 시도코드 (행안부 2자리, 예: "41" 경기) */
  sido?: string;
  /** 시군구코드 (행안부 5자리, 예: "41570" 김포) */
  gugun?: string;
  /** 읍면동코드 (행안부 10자리, 예: "4157034033" 대명리. 실제로는 면 단위 매칭) */
  dong?: string;
  /** 건물면적 ㎡ */
  barea_min?: string;
  barea_max?: string;
  /** 토지면적 ㎡ */
  larea_min?: string;
  larea_max?: string;
  /** 최저가 */
  lowMin?: string;
  lowMax?: string;
  /** 감정가 */
  gamMin?: string;
  gamMax?: string;
  /** 매각기일 (YYYY-MM-DD) */
  sday_s?: string;
  sday_e?: string;
  /** 사건년도 (YYYY) */
  syear?: string;
  /** 사건번호 */
  sno?: string;
}

/**
 * 진행물건검색 응답의 매물 1건 — raw 응답 그대로의 키.
 * 실제 응답에서 발견된 29개 필드 (검증 v2-6 _test_06_search_김포.json).
 */
export interface AuctionRawListItem {
  /** 경매번호 — 상세 호출 (au0147001254) 의 product_id 로 사용 */
  경매번호: number;
  /** 사건번호코드 — 내부 식별자 (product_id 와 다름! 상세 호출에 사용 X) */
  사건번호코드: number;
  /** 법원코드 (예: "C2") */
  법원코드: string;
  /** 사건년도 (예: 2023) */
  사건년도: number;
  /** 사건번호 (예: 51302) */
  사건번호: number;
  /** 물건번호 (한 사건에 여러 물건일 수 있음) */
  물건번호: number;
  /** 매각기일 (예: "2026-02-03 10:00:00") */
  매각기일: string;
  /** 감정가 (원, 소수점 형식 예: 1127326000.0000) */
  감정가: number;
  /** 최저가 (원) */
  최저가: number;
  /** 물건용도코드 (yongdo 와 매칭. 예: 33=임야) */
  물건용도코드: number;
  /** 진행상태코드 (현황코드. 예: 22=취하 등) */
  진행상태코드: number;
  /** 진행상태 (한글, 예: "매각", "취하", "진행", "유찰") */
  진행상태: string;
  /** 건물면적 ㎡ (토지만이면 null) */
  건물면적: number | null;
  /** 토지면적 ㎡ */
  토지면적: number | null;
  /** 유찰수 */
  유찰수: number;
  /** 도로명주소여부 (0=지번만 / 1=도로명도 있음) */
  도로명주소여부: number;
  /** 대표소재지 (예: "경기도 김포시 대곶면 율생리 197-1") */
  대표소재지: string;
  /** 담당계 (예: "3계") */
  담당계: string;
  /** 법원간략명 (예: "부천") */
  법원간략명: string;
  /** 리스트지번주소 (대표소재지와 거의 동일하지만 도로명 미포함) */
  리스트지번주소: string;
  /** 토지가격비율 (1=100%) */
  토지가격비율: number;
  /** 경매다용도 (예: "농지", "임야") */
  경매다용도?: string;
  /** 법원용도 (예: "전답") */
  법원용도?: string;
  /** 물건번호갯수 (한 사건의 총 물건 수) */
  물건번호갯수?: number;
  /** 낙찰가 (이미 낙찰된 매물의 낙찰 금액) */
  낙찰가?: number | null;
  /** 용도 (한글 카테고리, 예: "농지" — 의뢰자 결정: 그대로 표시) */
  용도?: string;
  /** 매각기일일자 (YYYY-MM-DD) */
  매각기일일자?: string;
  /** 매각기일일시 (HH:MM) */
  매각기일일시?: string;
  /** RowNumber */
  RowNumber?: string;
}

/** 진행물건검색 응답 본체 (data 영역). */
export interface AuctionRawListBody {
  success: "true" | "false";
  nowpage: string;
  totallist: string;
  totalpage: string;
  data: AuctionRawListItem[];
}

// ─── enrich 결과 (UI 직접 사용 형태) ──────────────────────

/**
 * 진행물건검색 응답 → UI 표시용 매물 1건 (enrich 후).
 * 추가 필드: pnuStandard, lat, lng, daysLeft, isUrgent, discountRatio.
 */
export interface AuctionListItem {
  // ── raw 그대로 ──
  경매번호: number;
  사건번호코드: number;
  법원코드: string;
  사건년도: number;
  사건번호: number;
  물건번호: number;
  매각기일: string;
  감정가: number;
  최저가: number;
  물건용도코드: number;
  진행상태코드: number;
  진행상태: string;
  건물면적: number | null;
  토지면적: number | null;
  유찰수: number;
  도로명주소여부: number;
  대표소재지: string;
  담당계: string;
  법원간략명: string;
  리스트지번주소: string;
  토지가격비율: number;
  경매다용도: string | null;
  법원용도: string | null;
  물건번호갯수: number | null;
  낙찰가: number | null;
  /** 용도 한글 (의뢰자 결정: Hyphen 응답 그대로 표시. 59종 분류 X) */
  용도: string | null;
  매각기일일자: string | null;
  매각기일일시: string | null;

  // ── 우리 추가 (enrich 단계) ──
  /** 사건명칭 (예: "2023타경51302") — 사건년도 + 사건번호 조합 */
  사건명칭: string;
  /**
   * ★ 행안부 표준 PNU 19자리 — 우리 시스템 기준정보.
   * 대표소재지(또는 리스트지번주소) 텍스트 파싱 + bjd_master JOIN 으로 조립.
   * 매물명에서 지번 추출 실패 시 null.
   */
  pnuStandard: string | null;
  /** 동/리 좌표 (PNU 앞 10자리 → bjd_master JOIN 결과) */
  lat: number | null;
  lng: number | null;
  /** 할인율 (감정가 대비, 0~1) */
  discountRatio: number;
  /** D-day (매각기일 - 오늘). 음수면 마감/종결 */
  daysLeft: number;
  /** D-3 이내 임박 매물 여부 */
  isUrgent: boolean;
}

// ─── 경매사건상세보기 (au0147001254) ──────────────────────

/** 상세 호출 응답의 매물 1건 — 45필드 (검증 v2-4 _test_v2_4_detail.json). */
export interface AuctionRawDetailItem {
  사건명칭: string;
  법원명: string;
  담당계: string;
  담당계전화: string;
  매각기일: string;
  물건용도: string;
  대표소재지: string;
  도로명주소: string | null;
  지번주소: string;
  접수일자: string;
  경매구분: string;
  보존등기구분: string;
  대지권면적: string;
  건물면적: string | null;
  배당종기일: string;
  소유자: string;
  채무자: string;
  채권자: string;
  /** 포맷팅된 문자열 ("1,127,326,000") */
  감정가: string;
  /** 포맷팅된 문자열 ("(49%)552,390,000") */
  최저가: string;
  /** 포맷팅된 문자열 ("(10%)55,239,000") */
  보증금: string;
  /** 매각조건 (예: "맹지" — 영업 핵심) */
  매각조건: string;
  기일남은일수: number;
  기일신건문구: string | null;
  /** 회차별 기일 리스트 */
  기일리스트: AuctionDateEntry[];
  /** 매물 사진 — auctionall.co.kr + 사진경로 */
  이미지리스트: AuctionImage[];
  /** 감정평가서 요약 (배열) */
  감정평가서요약: unknown[];
  /** 임차인현황 */
  임차인현황: unknown | null;
  /** 권리분석 — 말소기준권리 */
  말소기준권리: unknown | null;
  배당요구종기: string;
  /** 건물 등기부 */
  건물등기부: AuctionRegistry | null;
  /** 토지 등기부 */
  토지등기부: AuctionRegistry | null;
  진행과정: {
    경매개시일?: string;
    배당종기일?: string;
    감정평가일?: string;
    최초경매일?: string;
  };
  예상배당순서: AuctionDistribution[];
  /** 예상 명도비용 — 영업 시뮬레이션 핵심 */
  예상명도비용: AuctionEvictionCost | null;
  건축물현황: unknown | null;
  아파트정보: unknown | null;
  /** 인근물건 (사건상세 응답 안에 자동 첨부 — fallback 자동 지원) */
  인근물건: AuctionNearbyItem[];
  인근매각사례: unknown | null;
  역세권: AuctionStation[];
  개발계획: AuctionDevPlan[];
  관할정보: unknown | null;
  하단주의사항_01: string;
  하단주의사항_02: string;
  하단주의사항_03: string;
}

export interface AuctionImage {
  이미지일련번호: number;
  사진설명: string;
  /** "/auctionimg/2025/20250410/" — auctionall.co.kr 도메인 prefix 필요 */
  사진경로: string;
  파일명: string;
}

export interface AuctionDateEntry {
  최저가?: string;
  기일결과?: string;
  차수?: string;
  입찰인원?: number | null;
  기일종류?: string;
  [key: string]: unknown;
}

export interface AuctionRegistry {
  등기종류?: string;
  열람일자?: string;
  예상채권총액?: number;
  매각효력?: string;
  지상권개요?: string;
  명세서비고?: string;
  등기권리현황?: AuctionRegistryEntry[];
}

export interface AuctionRegistryEntry {
  순위번호?: string;
  접수일자?: string;
  접수번호?: string;
  등기목적?: string;
  권리종류?: string;
  권리자?: string;
  채권금액?: string;
  말소기준?: number;
  비고?: string;
  [key: string]: unknown;
}

export interface AuctionDistribution {
  순번?: string;
  종류?: string;
  채권자?: string;
  권리금액?: string;
  배당금액?: string;
  미배당금액?: string;
  배당후잔액?: string;
  낙찰자인수?: string;
}

export interface AuctionEvictionCost {
  금액?: string;
  면적?: number;
  노무인원?: number;
  컨테이너대수?: number;
  노무비?: number;
  보관비?: number;
  접수비?: number;
  컨테이너비용?: number;
  종합?: string;
}

export interface AuctionNearbyItem {
  구분?: string;
  사건번호?: string;
  인근물건?: string;
  용도?: string;
  매각기일?: string;
  감정가?: string;
  최저가?: string;
}

export interface AuctionStation {
  subwayno?: number;
  노선명?: string;
  역명?: string;
  거리?: number;
}

export interface AuctionDevPlan {
  법정명?: string;
  LURISNO?: number;
  GUBUN?: string;
  SUBJECT?: string;
  URL?: string;
  OPENDATE?: string;
}

/** AuctionListItem + 상세 필드를 결합한 형태 (UI 다이얼로그용). */
export interface AuctionDetail extends AuctionListItem {
  /** raw 상세 응답 — UI 가 필요한 부분만 골라 사용 */
  detail: AuctionRawDetailItem;
}

// ─── client 응답 wrapper ─────────────────────────────────

/** fetch 함수의 결과 — apiStatus 와 enrich 후 매물 동시 반환. */
export interface AuctionListPageResult {
  apiStatus: HyphenApiStatus;
  errCd: string;
  errMsg: string;
  /** apiStatus="ok" 일 때만 의미. 그 외엔 빈 배열. */
  items: AuctionRawListItem[];
  nowpage: number;
  totallist: number;
  totalpage: number;
}
