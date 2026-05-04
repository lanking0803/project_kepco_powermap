/**
 * 법원경매 (court) 채널 전용 카테고리 시스템.
 *
 * ✅ 검증 완료 2026-05-05 — 의뢰자 직접 응답 캡처 8건.
 * 응답 출처: docs/api_specs/법원경매/ (대분류·중분류·소분류 트리 raw JSON 보존)
 *
 * 설계 원칙:
 *   - hyphen 채널과 완전 분리 (이전 구조: hyphen 코드 → court 변환 → 호출 — 폐기)
 *   - 사용자가 court 분류 코드를 직접 선택 → 트리플 합성 → court API 호출
 *   - hyphen 채널은 별도 시스템(lib/modes/modes/auction.ts)에서 관리. swap 시 분기로 전환.
 *
 * 사용:
 *   - `COURT_LCL_LIST` / `COURT_MCL_BY_LCL` / `COURT_SCL_BY_MCL` 트리 데이터
 *   - `COURT_CATEGORY_GROUPS` 영업 6그룹 단축 칩
 *   - `sclCodesToTriples(sclCodes)` 선택된 소분류 코드 → court sweep 트리플 변환
 */

// ─── 트리 데이터 ─────────────────────────────────────────────

/** 대분류 — 부동산 탭 한정 (동산 탭은 별도). */
export const COURT_LCL_LIST = [
  { code: "10000", name: "토지" },
  { code: "20000", name: "건물" },
] as const;

/** 중분류 — 대분류별 매핑. 응답 usgMclLst 그대로. */
export const COURT_MCL_BY_LCL: Record<string, Array<{ code: string; name: string }>> = {
  "10000": [{ code: "10100", name: "지목" }],
  "20000": [
    { code: "20100", name: "주거용건물" },
    { code: "21100", name: "상업용및업무용" },
    { code: "22100", name: "산업용및기타특수용" },
    { code: "23100", name: "용도복합용" },
  ],
};

/** 소분류 — 중분류별 매핑. 응답 usgSclLst 그대로. */
export const COURT_SCL_BY_MCL: Record<string, Array<{ code: string; name: string }>> = {
  // 토지 / 지목 (28개)
  "10100": [
    { code: "10101", name: "전" },
    { code: "10102", name: "답" },
    { code: "10103", name: "과수원" },
    { code: "10104", name: "목장용지" },
    { code: "10105", name: "임야" },
    { code: "10106", name: "광천지" },
    { code: "10107", name: "염전" },
    { code: "10108", name: "대지" },
    { code: "10109", name: "공장용지" },
    { code: "10110", name: "학교용지" },
    { code: "10111", name: "주차장" },
    { code: "10112", name: "주유소용지" },
    { code: "10113", name: "창고용지" },
    { code: "10114", name: "도로" },
    { code: "10115", name: "철도용지" },
    { code: "10116", name: "제방" },
    { code: "10117", name: "하천" },
    { code: "10118", name: "구거" },
    { code: "10119", name: "유지" },
    { code: "10120", name: "양어장" },
    { code: "10121", name: "수도용지" },
    { code: "10122", name: "공원" },
    { code: "10123", name: "체육용지" },
    { code: "10124", name: "유원지" },
    { code: "10125", name: "종교용지" },
    { code: "10126", name: "사적지" },
    { code: "10127", name: "묘지" },
    { code: "10128", name: "잡종지" },
  ],
  // 건물 / 주거용건물 (11개)
  "20100": [
    { code: "20101", name: "단독주택" },
    { code: "20102", name: "다가구주택" },
    { code: "20103", name: "다중주택" },
    { code: "20104", name: "아파트" },
    { code: "20105", name: "연립주택" },
    { code: "20106", name: "다세대주택" },
    { code: "20107", name: "기숙사" },
    { code: "20108", name: "빌라" },
    { code: "20109", name: "상가주택" },
    { code: "20110", name: "오피스텔" },
    { code: "20111", name: "주상복합" },
  ],
  // 건물 / 상업용및업무용 (18개)
  "21100": [
    { code: "21101", name: "근린생활시설" },
    { code: "21102", name: "문화및집회시설" },
    { code: "21103", name: "종교시설" },
    { code: "21104", name: "판매시설" },
    { code: "21105", name: "운수시설" },
    { code: "21106", name: "의료시설" },
    { code: "21107", name: "교육연구시설" },
    { code: "21108", name: "노유자시설" },
    { code: "21109", name: "수련시설" },
    { code: "21110", name: "운동시설" },
    { code: "21111", name: "업무시설" },
    { code: "21112", name: "숙박시설" },
    { code: "21113", name: "위락시설" },
    { code: "21114", name: "교정및군사시설" },
    { code: "21115", name: "방송통신시설" },
    { code: "21116", name: "발전시설" },
    { code: "21117", name: "묘지관련시설" },
    { code: "21118", name: "관광휴게시설" },
  ],
  // 건물 / 산업용및기타특수용 (6개)
  "22100": [
    { code: "22101", name: "공장" },
    { code: "22102", name: "창고시설" },
    { code: "22103", name: "위험물저장및처리시설" },
    { code: "22104", name: "자동차관련시설" },
    { code: "22105", name: "동물및식물관련시설" },
    { code: "22106", name: "분뇨및쓰레기처리시설" },
  ],
  // 건물 / 용도복합용 (3개)
  "23100": [
    { code: "23101", name: "주/상용건물" },
    { code: "23102", name: "주/산용건물" },
    { code: "23103", name: "기타복합용건물" },
  ],
};

// ─── 영업 6그룹 — 단축 칩 ────────────────────────────────────

/** 영업 시각 그룹 ID. 의뢰자 영업 우선순위 기준으로 묶음. */
export type CourtCategoryGroup =
  | "토지농지"   // 노지 태양광 1순위
  | "공장창고"   // 옥상 태양광 1순위
  | "주거"
  | "상업업무"
  | "공공시설"
  | "특수";

/**
 * 그룹 → 소분류 코드 배열.
 * 그룹 칩 클릭 시 모든 멤버 소분류 ON/OFF 일괄 토글.
 *
 * 영업 의도:
 *   - 토지농지: 농지 + 임야 + 잡종지 (태양광 노지 영업 핵심)
 *   - 공장창고: 공장 + 창고 + 공장용지/창고용지(토지) + 동물식물(축사)
 *   - 주거: 주거용건물 11개 전부 (주상복합 포함)
 *   - 상업업무: 상업/업무 핵심 + 용도복합 3개
 *   - 공공시설: 공공 성격 + 토지 공공용지
 *   - 특수: 발전시설/주유소/위험물/자동차/분뇨 등 — 의뢰자 신규 영업 가능성
 */
export const COURT_CATEGORY_GROUPS: Record<CourtCategoryGroup, string[]> = {
  토지농지: ["10101", "10102", "10103", "10104", "10105", "10128"],
  공장창고: ["22101", "22102", "10109", "10113", "22105"],
  주거: ["20101", "20102", "20103", "20104", "20105", "20106", "20107", "20108", "20109", "20110", "20111"],
  상업업무: ["21101", "21104", "21111", "21112", "21118", "23101", "23102", "23103"],
  공공시설: [
    "21102", "21103", "21106", "21107", "21108", "21117",
    "10110", "10122", "10123", "10125", "10127",
  ],
  특수: ["21116", "10112", "22103", "22104", "22106"],
};

/** 그룹 표시 라벨 + 한 줄 설명 — 칩 hover 보조 텍스트용. */
export const COURT_GROUP_LABEL: Record<
  CourtCategoryGroup,
  { label: string; sub: string }
> = {
  토지농지: { label: "토지/농지", sub: "전·답·과수원·임야·잡종지" },
  공장창고: { label: "공장/창고", sub: "공장·창고·공장용지·축사" },
  주거: { label: "주거", sub: "아파트·빌라·주택·오피스텔·주상복합" },
  상업업무: { label: "상업/업무", sub: "근린·업무·숙박·복합용" },
  공공시설: { label: "공공시설", sub: "학교·체육·종교·묘지·문화" },
  특수: { label: "특수", sub: "발전·주유소·위험물·자동차" },
};

/** 그룹 표시 순서 — 영업 우선순위. */
export const COURT_CATEGORY_GROUP_ORDER: CourtCategoryGroup[] = [
  "토지농지",
  "공장창고",
  "주거",
  "상업업무",
  "공공시설",
  "특수",
];

// ─── 헬퍼 ───────────────────────────────────────────────────

/**
 * 소분류 코드 → court sweep 트리플 (lcl/mcl/scl).
 * 코드 prefix 로 lcl/mcl 추론 (5자리 = 처음 1자리 lcl / 처음 3자리 mcl).
 * 잘못된 코드는 무시.
 */
export function sclCodesToTriples(sclCodes: string[]): Array<{
  lclCd: string;
  mclCd: string;
  sclCd: string;
}> {
  const out: Array<{ lclCd: string; mclCd: string; sclCd: string }> = [];
  const seen = new Set<string>();
  for (const scl of sclCodes) {
    if (!/^\d{5}$/.test(scl)) continue;
    const lclCd = `${scl[0]}0000`;
    const mclCd = `${scl.slice(0, 3)}00`;
    // 트리에 실제 있는 코드만
    const sclList = COURT_SCL_BY_MCL[mclCd];
    if (!sclList || !sclList.find((x) => x.code === scl)) continue;
    if (seen.has(scl)) continue;
    seen.add(scl);
    out.push({ lclCd, mclCd, sclCd: scl });
  }
  return out;
}

/** 소분류 코드 → 한글 이름 (없으면 코드 그대로). */
export function sclCodeToName(sclCd: string): string {
  for (const list of Object.values(COURT_SCL_BY_MCL)) {
    const f = list.find((x) => x.code === sclCd);
    if (f) return f.name;
  }
  return sclCd;
}
