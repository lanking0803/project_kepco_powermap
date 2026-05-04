/**
 * 시설 모드 디테일 — PersistedState 타입 + 기본값.
 *
 * 검색 입력은 시도/시군구/읍·면·동(필수). 외부 건축HUB API 가
 * sigunguCd+bjdongCd 둘 다 강제하므로 동까지 강제 선택.
 *
 * 추가로 시설 카테고리(다중 선택) + 최소 평수(슬라이더) 가 클라이언트
 * 후처리 필터로 작동.
 *
 * 본 파일은 "모드 디테일" 만 담당 — UI/검색 로직은 FacilitySearchPanel.
 */
import type { FacilityListItem } from "@/lib/facility/enrich";
import {
  type FacilityCategory,
  defaultSelectedCategories,
} from "@/lib/facility/classify";

/** 검색 입력 — 시도/시군구/읍·면·동 (+농촌이면 리) + 카테고리 + 평수 */
export interface FacilitySearchParams {
  /** 시도 한글명 (예: "전라남도") */
  sido: string;
  /** 시군구 한글명 (예: "여수시") */
  sigungu: string;
  /** 시군구 5자리 코드 (예: "46050") */
  sigunguCode: string;
  /** 읍·면·동 한글명 (예: "구례읍") — 필수 */
  eupmyeondong: string;
  /** 읍·면·동 10자리 bjd_code (예: "4673025000") — 도시면 외부 API 호출 키, 농촌이면 부모 노드 */
  eupmyeondongCode: string;
  /** 도시 동 = false (리 dropdown 안 나타남), 농촌 면 = true (리 선택 필수) */
  hasRi: boolean;
  /**
   * 리 선택값:
   * - 도시 동 (hasRi=false): "" 고정
   * - 농촌 면 (hasRi=true):
   *   - "ALL" = 전체 (해당 면의 모든 리 병렬 호출)
   *   - 10자리 bjd_code = 특정 리 1개
   *   - "" = 미선택 (검색 불가)
   */
  riCode: string;
  /** 리 한글명 (UI 표시용, "전체" 포함) */
  riLabel: string;
  /** 시설 카테고리 (다중 선택, 최소 1개) */
  categories: FacilityCategory[];
  /** 최소 평수 (이상). 0 = 평수 필터 없음 */
  minPyeong: number;
}

/**
 * 검색 결과 1건 — 화면 마커/카드용.
 *
 * FacilityListItem 의 alias. 서버 atomic endpoint(/api/facility/search) 가
 * bjd_master JOIN 으로 lat/lng 까지 박아 내려주므로 클라이언트는 이걸 그대로 사용.
 */
export type FacilitySearchResult = FacilityListItem;

/** sessionStorage 저장 상태 */
export interface FacilityPersistedState {
  params: FacilitySearchParams;
  /**
   * 검색으로 받은 결과 (분류·좌표·평수 박힌 FacilityListItem[]).
   * 사용자가 카테고리/평수 토글 시 이걸 클라이언트에서 즉시 재필터 — 호출 0.
   * 새로고침 시 복원하면 호출 없이 필터 바로 가능.
   *
   * 기존 필드명 `rawBuildings` (BuildingTitleInfo[]) 와 호환 안 됨 — 이전 세션
   * sessionStorage 가 남아있으면 빈 배열로 fallback.
   */
  rawItems: FacilityListItem[];
  /** 외부 API 매치 전체 건수 (capped 시 우리가 받은 것보다 큼) */
  totalCount: number;
  /** 캡 도달로 잘렸는지 — UI 안내용 */
  capped: boolean;
}

/** 검색 입력값 기본값 */
export const FACILITY_EMPTY_PARAMS: FacilitySearchParams = {
  sido: "",
  sigungu: "",
  sigunguCode: "",
  eupmyeondong: "",
  eupmyeondongCode: "",
  hasRi: false,
  riCode: "",
  riLabel: "",
  categories: [...defaultSelectedCategories()],
  minPyeong: 0,
};

/**
 * 검색 가능 여부:
 *   - 도시 (hasRi=false): 읍·면·동 코드(eupmyeondongCode) 10자리 + 카테고리 ≥ 1
 *   - 농촌 (hasRi=true):  읍·면·동 + 리 선택 ("ALL" 또는 10자리 코드) + 카테고리 ≥ 1
 */
export function canFacilitySearch(p: FacilitySearchParams): boolean {
  if (p.categories.length === 0) return false;
  if (!/^\d{10}$/.test(p.eupmyeondongCode)) return false;
  if (p.hasRi) {
    // 농촌: "ALL" 또는 10자리 코드
    if (p.riCode !== "ALL" && !/^\d{10}$/.test(p.riCode)) return false;
  }
  return true;
}
