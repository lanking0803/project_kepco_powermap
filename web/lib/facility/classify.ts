/**
 * 시설 모드 — 건축물대장 표제부 → 카테고리 분류 + 평수 필터.
 *
 * 외부 API(getBrTitleInfo) 가 검색 필터를 지원하지 않아서, 법정동 단위로 받은
 * 모든 건물을 우리가 클라이언트 측에서 분류·필터링한다.
 *
 * 매칭은 mainPurpsCd(5자리 표준코드) 우선. 한글명(mainPurpsCdNm) 매칭은
 * 표기 변동 위험이 있어 보조용도(유리온실/축사 etcPurps 세분)에만 사용.
 *
 * 검증 (2026-05-03):
 *   - 21000 한글명 = "동물및식물관련시설" (조사 보고서의 "동·식물관련시설"과 다름)
 *   - 코드 매칭이 안전, 한글 매칭은 깨짐
 */
import type { BuildingTitleInfo } from "@/lib/building-hub/title";

/** 시설 모드 카테고리 — 영업 가치 우선순위 정렬 (2026-05-03 의뢰자 영업 행태 기준 6종 압축) */
export type FacilityCategory =
  | "greenhouse" // 유리온실
  | "barn" // 축사
  | "factory" // 공장
  | "warehouse" // 창고시설
  | "animalplant_etc" // 동·식물 기타
  | "other"; // 기타 시설 (위 5종 외 모든 용도 — 업무/판매/운수/교육연구/근린/주거 등)

export interface FacilityCategoryInfo {
  id: FacilityCategory;
  label: string;
  /** 영업 핵심(기본 ON) vs 보조(기본 OFF) */
  defaultOn: boolean;
  /** UI dropdown/list 표시 순서 */
  order: number;
}

export const FACILITY_CATEGORIES: Record<FacilityCategory, FacilityCategoryInfo> = {
  greenhouse: { id: "greenhouse", label: "유리온실", defaultOn: true, order: 1 },
  barn: { id: "barn", label: "축사", defaultOn: true, order: 2 },
  factory: { id: "factory", label: "공장", defaultOn: true, order: 3 },
  warehouse: { id: "warehouse", label: "창고시설", defaultOn: true, order: 4 },
  animalplant_etc: { id: "animalplant_etc", label: "동·식물 기타", defaultOn: true, order: 5 },
  other: { id: "other", label: "기타 전체", defaultOn: false, order: 6 },
};

export const FACILITY_CATEGORY_ORDER: FacilityCategory[] = [
  "greenhouse",
  "barn",
  "factory",
  "warehouse",
  "animalplant_etc",
  "other",
];

/** 기본 ON 카테고리 셋 (검색 패널 초기 상태) */
export function defaultSelectedCategories(): Set<FacilityCategory> {
  return new Set(
    FACILITY_CATEGORY_ORDER.filter((c) => FACILITY_CATEGORIES[c].defaultOn),
  );
}

/* ────────────────────────────────────────────────────────────
 *  분류
 * ──────────────────────────────────────────────────────────── */

/** etcPurps 키워드로 유리온실 식별 */
const GREENHOUSE_KEYWORDS = ["온실", "유리온실", "비닐하우스"];
/** etcPurps 키워드로 축사 식별 */
const BARN_KEYWORDS = ["축사", "돈사", "계사", "우사", "마사", "양계", "양돈", "양우"];

/** roofCd "41" = 유리 지붕 (유리온실 보조 식별) */
const ROOF_GLASS_CODE = "41";

/**
 * 단일 건물 → 카테고리 1개 매핑.
 *
 * 부속건축물(mainAtchGbCd === "1")은 null 반환 (시설 모드에서 제외).
 * 21000(동·식물) 은 etcPurps/roofCd 로 세분, 안 잡히면 animalplant_etc.
 * 그 외는 mainPurpsCd 코드 매칭.
 */
export function classifyBuilding(b: BuildingTitleInfo): FacilityCategory | null {
  // 부속건축물 제외
  if (b.mainAtchGbCd === "1") return null;

  const code = b.mainPurpsCd ?? "";
  const etc = b.etcPurps ?? "";
  const roof = b.roofCd ?? "";

  // 21000 = 동·식물관련시설 — etcPurps + roofCd 로 세분
  if (code === "21000") {
    // 유리온실: 지붕 유리 또는 etcPurps 에 온실 키워드
    if (roof === ROOF_GLASS_CODE) return "greenhouse";
    if (GREENHOUSE_KEYWORDS.some((kw) => etc.includes(kw))) return "greenhouse";
    // 축사: etcPurps 키워드
    if (BARN_KEYWORDS.some((kw) => etc.includes(kw))) return "barn";
    // 그 외 동·식물
    return "animalplant_etc";
  }

  // 핵심 5종 외 모든 코드는 "기타 전체" 로 통합 (사용자 1클릭 토글)
  switch (code) {
    case "17000": return "factory";
    case "18000": return "warehouse";
    default:      return "other";
  }
}

/* ────────────────────────────────────────────────────────────
 *  필터
 * ──────────────────────────────────────────────────────────── */

export interface FacilityFilterOptions {
  /** 사용자가 선택한 카테고리 셋 (1개 이상) */
  categories: Set<FacilityCategory>;
  /** 최소 평수 (이상). 0 = 평수 필터 없음 */
  minPyeong: number;
}

/**
 * 카테고리 + 평수 필터 적용.
 *
 * - 카테고리 셋에 속한 카테고리 OR 매칭
 * - archArea 가 있고 평 변환 후 minPyeong 이상
 * - archArea 미상은 평수 필터가 켜진(>0) 경우 제외 (1.3% 손실 허용 — 영업 타겟 아님)
 */
export interface ClassifiedBuilding {
  building: BuildingTitleInfo;
  category: FacilityCategory;
  /** 평으로 변환된 건축면적 (소수점 포함, 1자리 반올림). null = archArea 미상 */
  pyeong: number | null;
}

export function filterAndClassifyBuildings(
  rows: BuildingTitleInfo[],
  opts: FacilityFilterOptions,
): ClassifiedBuilding[] {
  const out: ClassifiedBuilding[] = [];
  for (const b of rows) {
    const cat = classifyBuilding(b);
    if (cat == null) continue;
    if (!opts.categories.has(cat)) continue;

    const pyeong = m2ToPyeong(b.archArea);
    if (opts.minPyeong > 0) {
      if (pyeong == null) continue; // 평수 필터 켰는데 미상 = 제외
      if (pyeong < opts.minPyeong) continue;
    }
    out.push({ building: b, category: cat, pyeong });
  }
  return out;
}

/* ────────────────────────────────────────────────────────────
 *  평수 헬퍼
 * ──────────────────────────────────────────────────────────── */

const SQM_PER_PYEONG = 3.305785;

/** ㎡ → 평. null/0 입력은 null. */
export function m2ToPyeong(m2: number | null | undefined): number | null {
  if (m2 == null) return null;
  if (!Number.isFinite(m2) || m2 <= 0) return null;
  return Math.round((m2 / SQM_PER_PYEONG) * 10) / 10;
}

/**
 * 평수 압축 라벨 (마커 안 표시용).
 *   < 1000   → "120"
 *   1000~10000 → "1.5K"
 *   100000+  → "120K"
 */
export function formatPyeongCompact(m2: number | null | undefined): string {
  const py = m2ToPyeong(m2);
  if (py == null) return "—";
  if (py < 1000) return String(Math.round(py));
  if (py < 100_000) return `${(py / 1000).toFixed(1)}K`;
  return `${Math.round(py / 1000)}K`;
}
