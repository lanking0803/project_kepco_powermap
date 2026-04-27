/**
 * 견적 모드 PDF 출력용 회사 정보.
 *
 * 의뢰자 박힌 값 (docs/견적_1차2차.md §회사 정보).
 * 추후 관리자 페이지에서 변경 가능 구조 (1차 범위 외).
 */

export const COMPANY = {
  name: "(주)솔라엘디",
  englishName: "Solar LD inc",
  address: "대구광역시 동구 안심뉴타운로 32",
  phone: "053) 856-9698",
  fax: "0504) 370-2940",
  email: "slddettkh@naver.com",
} as const;

/**
 * 회사 로고 이미지 경로 (public/ 기준).
 *
 * 의뢰자 로고 제작 중 — 파일이 도착하면 같은 경로에 덮어쓰면 자동 반영.
 * 로드 실패 시 PrintLayout 의 onError 폴백으로 placeholder 박스가 뜸.
 */
export const COMPANY_LOGO_PATH = "/print/company-logo.png";
