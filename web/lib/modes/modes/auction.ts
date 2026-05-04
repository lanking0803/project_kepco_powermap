/**
 * 경매(Hyphen) 모드 디테일 — PersistedState 타입 + 기본값.
 *
 * Hyphen 진행물건검색(au0147001252) 의 입력 파라미터를 영업담당자 시점으로
 * 재구성. UI 표시는 한글, Hyphen 호출은 코드(sido 2자리/gugun 5자리/yongdo 2자리)
 * 라서 두 표현을 함께 저장 — 사용자 본 그대로 복원 + 코드 호출 안정성.
 *
 * 카테고리 그룹/라벨/yongdo 매핑은 UI 단계에서 결정. 본 파일은 모델만.
 *
 * 본 파일은 "모드 디테일" 만 담당 — UI/검색 로직은 AuctionSearchPanel.
 */
import type { AuctionListItem } from "@/lib/hyphen/types";

/**
 * 경매 검색 패널 입력값.
 *
 * 지역 — 시도/시군구는 atomic(/api/regions/sigungu) 드롭다운, 읍면동은 텍스트.
 *   · sido/sigungu 한글 = 사용자 표시 + sessionStorage 복원
 *   · sigunguCode 5자리 = Hyphen `gugun` 호출 키
 *   · emdong 텍스트 = Hyphen `dong` 코드 변환 데이터 부재 → 응답 후 클라이언트 LIKE 필터
 *
 * 카테고리 — yongdoCodes 다중 선택 (Hyphen 용도 59종 중 일부). 빈 배열 = 전체.
 *   · 그룹 칩(토지농지/공장창고/주거/상업업무/공공시설/동산) 은 UI 헬퍼.
 *   · Hyphen 검색 파라미터는 단일 yongdo 라서, 다중 선택 시 페이지 sweep 을 코드별 분리 호출 후 합본 (백엔드 책임).
 *
 * 진행상태 — 응답에 종결건(매각/취하)도 섞여 옴 → 클라이언트 필터.
 *   · 기본값 ["진행","유찰"] = 입찰 가능 매물만 (영업 의도).
 *
 * 가격 단위 — 만원 (사용자 입력 친화). Hyphen 호출 시 ×10000 변환.
 */
export interface AuctionSearchUiParams {
  // ── 지역 ──
  /** 시도 한글명 (예: "경기도") — 드롭다운 표시 + sessionStorage 복원용 */
  sido: string;
  /** 시군구 한글 통합표기 (예: "성남시 분당구") — 드롭다운 표시용 */
  sigungu: string;
  /** 시군구 5자리 행안부 코드 (예: "41135") — Hyphen `gugun` 호출 키 */
  sigunguCode: string;
  /** 읍면동 텍스트 (선택, 예: "대곶면") — 응답 후 클라이언트 필터 */
  emdong: string;

  // ── 카테고리 ──
  /**
   * 선택된 Hyphen 용도코드 다중 (예: ["31","33"] = 농지+임야). 빈 배열 = 전체.
   * channel="hyphen" 일 때만 의미. court 채널은 `courtSclCodes` 사용.
   */
  yongdoCodes: string[];

  /**
   * 선택된 Court 소분류 코드 다중 (예: ["10101","10102"] = 전+답). 빈 배열 = 전체.
   * channel="court" 일 때만 의미. hyphen 채널은 `yongdoCodes` 사용.
   * court 분류 트리: lib/court-auction/categories.ts (검증된 76개 코드).
   */
  courtSclCodes: string[];

  // ── 진행상태 ──
  /**
   * 한글 진행상태 다중. v5 검증(2026-05-02)에서 응답 등장값:
   *   "신건"(첫 회차) / "진행" / "유찰" / "매각" / "취하" / "변경" / "정지"
   * 기본 = 입찰 가능 매물(영업 핵심) → 신건+진행+유찰. 응답 후 클라이언트 필터.
   */
  progressStatus: string[];

  // ── 면적 (㎡) ──
  /** 토지면적 (Hyphen larea_min/max) */
  landMin: number | null;
  landMax: number | null;
  /** 건물면적 (Hyphen barea_min/max) */
  bareaMin: number | null;
  bareaMax: number | null;

  // ── 가격 (만원, 호출 시 ×10000) ──
  /** 감정가 (Hyphen gamMin/Max) */
  gamMin: number | null;
  gamMax: number | null;
  /** 최저가 (Hyphen lowMin/Max) — 경매 특화 (다음 회차 입찰 시작가) */
  lowMin: number | null;
  lowMax: number | null;

  // ── 매각기일 (YYYY-MM-DD) ──
  /**
   * v5 검증으로 확인 — 필터 없이 검색 시 응답이 종결건(취하/매각) 위주로 정렬됨.
   * 영업 매물(진행/유찰/신건)은 매각기일 미래 필터로 좁혀야 효율적.
   * 기본값 = 오늘 ~ +6개월 (computeDefaultBidWindow 헬퍼).
   */
  bidStart: string | null;
  bidEnd: string | null;

  // ── 유찰 횟수 — Hyphen 검색 파라미터엔 없음, 응답 후 클라이언트 필터 ──
  usbdMin: number | null;
  usbdMax: number | null;

  // ── 할인율 (%) — 차별화 포인트. (감정가 - 최저가) / 감정가 × 100. 응답 후 클라이언트 필터. ──
  /** 최소 할인율 (%, 0~100). 예: 30 = "감정가 대비 30% 이상 할인된 매물". */
  discountMin: number | null;
  /** 최대 할인율 (%) — 보통 비워둠. */
  discountMax: number | null;

  // ── 법원 ──
  /** Hyphen au0147001245 응답의 법원코드 (예: "C2"). 빈 문자열 = 전체. */
  courtCode: string;

  // ── 페이지 ──
  pageNo: number;
  numOfRows: number;
}

/** 검색 패널이 sessionStorage 에 저장하는 상태. */
export interface AuctionPersistedState {
  params: AuctionSearchUiParams;
  results: AuctionListItem[];
  /** Hyphen 응답 totallist 합본 (cap 초과 안내용) — 모르면 null */
  totalCountAll: number | null;
}

/**
 * Hyphen 용도 59종 → 영업담당자 친화 6그룹 매핑.
 *
 * v5 검증(2026-05-02) au0147001250 응답의 59종을 영업 시각으로 묶음.
 * 그룹 칩 클릭 = 그 그룹 멤버 모두 토글 (ON ↔ OFF). 그룹 안 개별 코드도
 * 펼쳐서 정밀 다중 선택 가능.
 *
 * Hyphen 검색은 `yongdo` 단일 코드만 받으므로 다중 선택 시 백엔드가
 * 코드별 N번 호출 후 union dedup (검색 비용은 사용자에게 명시적으로 안내).
 */
export type AuctionCategoryGroup =
  | "토지농지"      // 태양광 노지 1순위
  | "공장창고"      // 옥상 태양광 1순위
  | "주거"
  | "상업업무"
  | "공공시설"
  | "동산";

/** 그룹 → 포함 yongdo 코드 (Hyphen au0147001250 응답 기준). */
export const AUCTION_CATEGORY_GROUPS: Record<AuctionCategoryGroup, string[]> = {
  토지농지: ["31", "33", "34", "36", "37", "38", "40", "41", "42", "43", "44", "51"],
  공장창고: ["12", "16", "17", "18", "39", "45"],
  주거: ["01", "02", "03", "06", "07"],
  상업업무: ["05", "11", "13", "14", "15", "19", "20", "22", "25", "52"],
  공공시설: ["21", "24", "35", "46", "47", "48", "53", "54", "55", "56", "62"],
  동산: ["23", "57", "58", "59", "60", "61", "71", "72", "73", "74", "75", "76", "77", "78", "79"],
};

/** 그룹 표시 라벨 + 한 줄 설명 — 칩 hover/카드 보조 텍스트용. */
export const AUCTION_GROUP_LABEL: Record<
  AuctionCategoryGroup,
  { label: string; sub: string }
> = {
  토지농지: { label: "토지/농지", sub: "농지·임야·대지·잡종지 등" },
  공장창고: { label: "공장/창고", sub: "공장·창고·아파트형공장" },
  주거: { label: "주거", sub: "아파트·빌라·주택" },
  상업업무: { label: "상업/업무", sub: "근린상가·오피스텔·사무실" },
  공공시설: { label: "공공시설", sub: "학교·종교·체육·묘지" },
  동산: { label: "동산", sub: "자동차·선박·어업권 등" },
};

/** yongdo 코드 → 한글 표시명 (au0147001250 응답 기준). 그룹 펼치기 시 칩 라벨. */
export const AUCTION_YONGDO_LABEL: Record<string, string> = {
  "01": "아파트", "02": "다세대(빌라)", "03": "주택",
  "05": "근린주택", "06": "다가구(원룸등)", "07": "도시형생활주택",
  "11": "근린상가", "12": "공장", "13": "오피스텔", "14": "근린시설",
  "15": "숙박시설", "16": "창고", "17": "아파트형공장", "18": "주유소(위험물)",
  "19": "목욕탕", "20": "의료시설", "21": "노유자시설", "22": "사무실",
  "23": "자동차관련시설", "24": "장례관련시설", "25": "문화및집회시설",
  "31": "농지", "33": "임야", "34": "대지", "35": "도로",
  "36": "잡종지", "37": "과수원", "38": "목장용지", "39": "공장용지",
  "40": "유지", "41": "구거", "42": "하천", "43": "제방",
  "44": "기타용지", "45": "창고용지", "46": "학교용지", "47": "체육용지",
  "48": "종교용지", "51": "농가관련시설", "52": "숙박(콘도등)", "53": "묘지",
  "54": "종교시설", "55": "주차장", "56": "교육시설", "57": "어업권",
  "58": "광업권", "59": "염전", "60": "양어장", "61": "기타",
  "62": "분뇨쓰레기처리",
  "71": "승용자동차", "72": "SUV", "73": "승합자동차", "74": "화물자동차",
  "75": "중장비", "76": "덤프트럭", "77": "차량기타", "78": "선박", "79": "항공기",
};

/** 그룹 표시 순서 — 영업 우선순위 (태양광 부지 1순위 = 토지농지/공장창고). */
export const AUCTION_CATEGORY_GROUP_ORDER: AuctionCategoryGroup[] = [
  "토지농지",
  "공장창고",
  "주거",
  "상업업무",
  "공공시설",
  "동산",
];

/**
 * 매각기일 기본 윈도우 — KST 오늘 ~ +6개월.
 * v5 검증 결과 영업 매물(진행/유찰/신건)이 미래 매각기일 필터로 정확히 좁혀짐.
 *
 * 매번 호출(=마운트 시 1회)이라 순수 함수. SSR 안전 (UTC 기반).
 */
export function computeDefaultBidWindow(): { bidStart: string; bidEnd: string } {
  const now = new Date();
  // KST 오늘 (브라우저 timezone 무관 — UTC 보정 후 +9 더해 일자만 추출)
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const start = kstNow.toISOString().slice(0, 10);
  const sixMonthsLater = new Date(kstNow);
  sixMonthsLater.setUTCMonth(sixMonthsLater.getUTCMonth() + 6);
  const end = sixMonthsLater.toISOString().slice(0, 10);
  return { bidStart: start, bidEnd: end };
}

/**
 * 검색 입력값 기본값 — 패널 초기 마운트 + "초기화" 버튼이 사용.
 *
 * v5 검증 반영:
 *   - progressStatus = ["신건","진행","유찰"] (입찰 가능 매물 — 종결건 노이즈 제거)
 *   - bidStart/End = 오늘~+6개월 (Hyphen 응답 정렬이 종결건 우선이라, 매각기일 좁혀야 영업 효율)
 *   - numOfRows = 1000 (UX/렌더 부담 한도)
 */
export const AUCTION_EMPTY_PARAMS: AuctionSearchUiParams = (() => {
  const { bidStart, bidEnd } = computeDefaultBidWindow();
  return {
    sido: "",
    sigungu: "",
    sigunguCode: "",
    emdong: "",
    yongdoCodes: [],
    courtSclCodes: [],
    progressStatus: ["신건", "진행", "유찰"],
    landMin: null,
    landMax: null,
    bareaMin: null,
    bareaMax: null,
    gamMin: null,
    gamMax: null,
    lowMin: null,
    lowMax: null,
    bidStart,
    bidEnd,
    usbdMin: null,
    usbdMax: null,
    discountMin: null,
    discountMax: null,
    courtCode: "",
    pageNo: 1,
    numOfRows: 1000,
  };
})();
