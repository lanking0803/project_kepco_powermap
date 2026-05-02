/**
 * 자연취락지구 모드 디테일 — PersistedState 타입 + 기본값.
 *
 * 검색 입력은 시도/시군구 단위. 응답도 시군구 단위(VWorld lt_c_uq128 의
 * std_sggcd 5자리 필터 한계). 더 좁은 단위 필터링은 클라이언트 후처리.
 *
 * 본 파일은 "모드 디테일" 만 담당 — UI/검색 로직은 UqVillageSearchPanel.
 */
import type { UqVillage } from "@/lib/vworld/uq-villages";

/** 검색 입력 — 시도/시군구만 (의뢰자 결정 2026-05-02). */
export interface UqSearchParams {
  sido: string;
  sigungu: string;
}

/** 검색 패널이 sessionStorage 에 저장하는 상태. */
export interface UqPersistedState {
  params: UqSearchParams;
  results: UqVillage[];
}

/** 검색 입력값 기본값 — 패널 초기 마운트 + "초기화" 버튼이 사용. */
export const UQ_EMPTY_PARAMS: UqSearchParams = {
  sido: "",
  sigungu: "",
};
