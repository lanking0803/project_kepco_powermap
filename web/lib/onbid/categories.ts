/**
 * 우리 카테고리 (5종) ↔ 캠코 cltrUsgSclsCtgrId (소분류 코드) 매핑.
 *
 * 캠코 코드표가 명세에 없어 실측으로 매핑 (test-onbid-codes.ts, 300건 샘플).
 *
 * 의뢰자 명시 5종:
 *   - 토지: 10100 시리즈 (대지/임야/전/답 등)
 *   - 유리온실, 축사: 캠코 sclsId 로는 분리 불가 → 매물명 키워드로 분류
 *   - 창고: 10402 (창고시설) 단일
 *   - 건물50plus: 50평+ 건축물 (주거/근린/업무/숙박 등 다양)
 *
 * 검증 결과:
 *   - cltrUsgSclsCtgrId 필터는 단일 코드만. 다중 매핑 카테고리는 응답 후필터.
 *   - 창고는 단일 코드 매핑 → 캠코 필터로 직접
 *   - 토지/건물50plus → 캠코 대분류만 (10000) 후 응답에서 sclsId 로 후필터
 *   - 유리온실/축사 → 매물명 키워드 후필터 (sclsId 가 동·식물 코드 거의 없음)
 */

import type { OurCategory } from "./types";

/** 토지 지목 — 캠코 10100 시리즈 (실측) */
const LAND_SCLS_IDS = new Set<string>([
  "10101", // 대지
  "10102", // 임야
  "10103", // 전
  "10104", // 답
  "10105", // 과수원
  "10108", // 체육용지
  "10116", // 주차장
  "10117", // 유원지
  "10119", // 도로
  "10129", // 기타토지
]);

/** 50평+ 건축물 후보 — 주거/근린/업무/숙박/공장 등 (실측) */
const BUILDING50_SCLS_IDS = new Set<string>([
  // 주거
  "10201", // 아파트
  "10204", // 단독주택
  "10205", // 다가구주택
  "10206", // 다세대주택
  "10208", // 도시형생활주택
  "10209", // 연립주택
  "10211", // 기숙사
  "10219", // 기타주거용건물
  // 근린/업무/숙박/판매
  "10301", // 근린생활시설
  "10302", // 문화및집회시설
  "10304", // 판매시설
  "10311", // 업무시설
  "10312", // 숙박시설
  // 산업/처리
  "10401", // 공장시설
  "10406", // 분뇨및쓰레기처리시설
  // 오피스텔
  "10503",
]);

/** 매물명 키워드 — 유리온실 / 축사 분기 */
const KEYWORD_GLASSHOUSE = ["유리온실", "비닐하우스", "온실", "화훼", "버섯재배"];
const KEYWORD_BARN = ["축사", "우사", "돈사", "계사", "양계장", "한우", "젖소"];

/**
 * 캠코 응답 1건 → OurCategory 분류.
 * 우선순위: 매물명 키워드 (유리온실/축사) > sclsId
 * 매칭 안 되면 null.
 */
export function classifyOurCategory(
  sclsId: string | null | undefined,
  cltrNm: string | null | undefined,
  bldSqms: number | null | undefined,
): OurCategory | null {
  const id = (sclsId ?? "").trim();
  const nm = (cltrNm ?? "").trim();

  // 매물명 키워드가 있으면 우선 적용 (지목과 무관하게 시설 의도 강함)
  if (KEYWORD_GLASSHOUSE.some((k) => nm.includes(k))) return "유리온실";
  if (KEYWORD_BARN.some((k) => nm.includes(k))) return "축사";

  // 창고시설 단독 코드
  if (id === "10402") return "창고";

  // 토지 지목군
  if (LAND_SCLS_IDS.has(id)) return "토지";

  // 50평+ 건축물 (165㎡ 기준)
  if (BUILDING50_SCLS_IDS.has(id)) {
    if ((bldSqms ?? 0) >= 165) return "건물50plus";
    return null; // 50평 미만은 우리 카테고리 아님
  }

  return null;
}

/**
 * 우리 카테고리 → 캠코 요청 params 의 cltrUsgSclsCtgrId 값 (단일).
 * 단일 코드 매핑 가능한 카테고리만 반환. 그 외 null → 호출 측이 대분류만 쓰고 사후 필터.
 */
export function ourCategoryToSclsParam(cat: OurCategory): string | null {
  if (cat === "창고") return "10402";
  // 토지/건물50plus 는 다중 코드 → 사후 필터
  // 유리온실/축사 는 매물명 키워드 → 사후 필터 (sclsId 단일 코드 없음)
  return null;
}
