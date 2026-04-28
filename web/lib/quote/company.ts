/**
 * 견적 모드 PDF 출력용 회사 정보.
 *
 * 의뢰자 박힌 값 (docs/견적_1차2차.md §회사 정보).
 * 추후 관리자 페이지에서 변경 가능 구조 (1차 범위 외).
 */

export const COMPANY = {
  name: "(주)한국에텍",
  englishName: "HKETECH",
  address: "광주광역시 광산구 비아도 24번길 56-4",
  phone: "062) 973-8846",
  fax: "061) 331-8807",
  mobile: "010-2627-8845",
  email: "cyo8845@hanmail.net",
  website: "www.hkelech.co.kr",
} as const;

/**
 * 회사 로고 이미지 경로 (public/ 기준).
 *
 * 임시: SUNLAP 마커 카드(흰 카드 + 파란 막대 3개 + 삼각 꼬리) SVG.
 *   — 메인 지도 마커(KakaoMap.makeMarkerHtml)와 동일 디자인을 추출한 것.
 * 의뢰자 정식 로고 PNG 도착 시 같은 폴더에 .png 두고 이 경로를 .png 로 교체.
 * 로드 실패 시 PrintLayout 의 onError 폴백으로 placeholder 박스가 뜸.
 */
export const COMPANY_LOGO_PATH = "/print/company-logo.svg";
