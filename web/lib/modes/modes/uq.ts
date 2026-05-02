/**
 * 자연취락지구 모드 디테일 — PersistedState 타입 + 기본값.
 *
 * 검색 입력은 시도/시군구 단위. 응답도 시군구 단위(VWorld lt_c_uq128 의
 * std_sggcd 5자리 필터 한계). 더 좁은 단위 필터링은 클라이언트 후처리.
 *
 * 본 파일은 "모드 디테일" 만 담당 — UI/검색 로직은 UqVillageSearchPanel.
 */
import type { UqVillageWithMatches } from "@/lib/uq/match-village";

/**
 * 검색 입력 — 시도/시군구 (의뢰자 결정 2026-05-02).
 *
 * 한글(sido/sigungu)은 UI 표시용, sigunguCode 는 API 호출 키.
 * 두 표현을 함께 저장 — 사용자가 보던 한글 그대로 복원 + 코드는 호출 안정성.
 * 둘 다 MapSummaryRow (MV) 한 행에서 동시에 추출 가능 (별도 fetch 불필요).
 */
export interface UqSearchParams {
  /** 시도 한글명 (예: "전라남도") — drop down 표시 + sessionStorage 복원용 */
  sido: string;
  /** 시군구 한글명 (예: "곡성군") — drop down 표시 + sessionStorage 복원용 */
  sigungu: string;
  /**
   * 시군구 5자리 행안부 표준 코드 (예: "46720") — API 호출 키.
   * bjd_code 10자리의 앞 5자리. VWorld lt_c_uq128 의 std_sggcd 와 매칭.
   */
  sigunguCode: string;
}

/** 검색 패널이 sessionStorage 에 저장하는 상태. */
export interface UqPersistedState {
  params: UqSearchParams;
  results: UqVillageWithMatches[];
}

/** 검색 입력값 기본값 — 패널 초기 마운트 + "초기화" 버튼이 사용. */
export const UQ_EMPTY_PARAMS: UqSearchParams = {
  sido: "",
  sigungu: "",
  sigunguCode: "",
};
