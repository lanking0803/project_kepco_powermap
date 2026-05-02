/**
 * 공매 모드 디테일 — PersistedState 타입 + 기본값.
 *
 * registry 는 모드의 외형(라벨/색/sessionKey),
 * storage 는 영속화 로직,
 * 본 파일은 "공매 한 모드만의" 데이터 모양을 책임진다.
 *
 * 다른 모드(취락지구/경매 등) 추가 시 같은 폴더에 1파일씩 추가.
 */
import type { OnbidListItem, OnbidSearchParams } from "@/lib/onbid/types";

/** 공매 검색 패널이 sessionStorage 에 저장하는 상태. */
export interface OnbidPersistedState {
  params: OnbidSearchParams;
  results: OnbidListItem[];
  totalCountAll: number | null;
}

/** 공매 검색 입력값 기본값 — 패널 초기 마운트 + "초기화" 버튼이 사용. */
export const ONBID_EMPTY_PARAMS: OnbidSearchParams = {
  sido: "",
  sigungu: "",
  emdong: "",
  categories: [],
  landMin: null,
  landMax: null,
  apslMin: null,
  apslMax: null,
  bidStart: null,
  bidEnd: null,
  usbdMin: null,
  usbdMax: null,
  pageNo: 1,
  numOfRows: 1000,
};
