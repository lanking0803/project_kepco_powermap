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
  /**
   * 캠코 응답의 ltnoPnu 19자리 (원본).
   *
   * ⚠️ 산구분(11번째 자리) 표기가 행안부 표준과 다름:
   *   - 캠코식: 0=일반, 1=산
   *   - 행안부:  1=일반, 2=산
   *
   * → 우리 시스템 모든 API 의 기준정보는 행안부 표준 PNU 이므로
   *   이 값을 외부 호출(VWorld·KEPCO·공시지가 등) 에 직접 사용 X.
   *   `pnuStandard` 를 사용해야 함. 본 필드는 디버그/캠코 원본 비교용.
   */
  ltnoPnu: string;
  /**
   * ★ 우리 시스템 기준정보 — 행안부 표준 PNU 19자리.
   * pnuFromOnbidItem(raw) 결과를 enrich 단계에서 첨부.
   * 매물명에서 지번 추출 실패 시 null (이론상 거의 발생 X).
   *
   * 모든 외부 API 호출 / 패널 진입 / 우리 DB 매칭은 이 값을 사용.
   */
  pnuStandard: string | null;
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

  // ── 회차 정보 (같은 cltrMngNo 의 다중 row 를 dedup 시 보존) ──
  // 캠코 회차 모델 실측 (test-onbid-debug-*.ts 2026-05-02):
  //   - 같은 매물(cltrMngNo)이 회차별로 N row 응답.
  //   - 유찰된 회차는 응답에서 빠짐 → 응답 row 갯수 = 남은 회차 수.
  //   - 현재 회차 = usbdNft + 1 (이미 유찰된 횟수의 다음).
  //   - 총 회차 = usbdNft + 응답 row 갯수.
  //   - 대표 row = 가장 임박한 회차(가장 작은 cltrBidEndDt) — D-day/가격 일치.
  //
  // ⚠️ 신뢰도 주의:
  //   - 시도 단위 검색(/api/onbid/search)은 numOfRows cap 으로 같은 매물 row 가 누락 가능
  //     → 목록 카드는 회차 정보 표시하지 않음. lowstBidPrc/discountRatio 만 활용.
  //   - 동단위 검색(/api/onbid/by-pnu)은 row 다 받음 → 정확. 상세 팝업에서 활용.
  //
  /** 총 회차 수 (이미 유찰 + 남은). 시도 검색에서는 부정확. */
  roundTotal: number;
  /** 현재 진행 회차 (usbdNft + 1, 1-base). 항상 신뢰 가능. */
  roundCurrent: number;
  /** 최저 시나리오 가격 — 가장 먼 미래 회차의 가격 (= 응답 마지막 sorted row). row 1개면 null. 시도 검색에서는 부정확. */
  minRoundPrice: number | null;
  /** 최저 시나리오 할인율 — 감정가 대비 (0~1). row 1개면 null. 시도 검색에서는 부정확. */
  minRoundDiscountRatio: number | null;
}

// ─── 상세 응답 (사진/감정평가/위치/입찰조건 등 부가 정보) ─────────────
//   getRlstDtlInf2 응답 실측(scripts/test-onbid-detail.ts) 기반.

export interface AppraisalRecord {
  /** 평가일자 (YYYYMMDD) */
  date: string;
  /** 감정평가기관명 */
  org: string;
  /** 감정평가사 (보통 null) */
  appraiser: string | null;
  /** 감정가 (원) */
  amount: number;
  /** 감정평가서 PDF URL (onbid.co.kr) */
  pdfUrl: string;
}

export interface OnbidDetail extends OnbidListItem {
  // ── 사진/멀티미디어 ──
  /** 물건 사진 URL — 원본(1.1MB) 갤러리 메인/라이트박스용 */
  photoUrls: string[];
  /** 물건 사진 URL — 썸네일(7KB) 갤러리 12x12 칸용 (페이지 부담 ↓) */
  photoThumbUrls: string[];
  /** 360도 사진 URL 목록 (있으면 멋진 시각 자료) */
  photo360Urls: string[];
  /** 영상 URL 목록 */
  videoUrls: string[];
  /** 위치도(지도) URL 목록 */
  locationMapUrls: string[];

  // ── 주소/물건 부가 ──
  /** 도로명 주소 전체 */
  cltrRadr: string | null;
  /** 기타사항 (엘리베이터/주차 등) */
  cltrEtcCont: string | null;
  /** 최초 공고일 (YYYYMMDD) */
  frstPbancYmd: string | null;

  // ── 입찰 조건 / 매수 자격 / 납부 사항 ──
  /** 입찰조건 내용 */
  icdlCdtnCont: string | null;
  /** 위치/접근성 묘사 (토지 입지 분석에 유용) */
  locVntyPscdCont: string | null;
  /** 활용/이용 내용 */
  utlzPscdCont: string | null;
  /** 처분 유효성 내용 */
  dsplVldCont: string | null;
  /** 매수 자격 내용 */
  purrQlfcCont: string | null;
  /** 납부 사항 내용 */
  pytnMtrsCont: string | null;
  /** 인도/인수 책임 */
  evcRsbyTrgtCont: string | null;

  // ── 감정평가 이력 (평가서 PDF 포함) ──
  appraisals: AppraisalRecord[];
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
