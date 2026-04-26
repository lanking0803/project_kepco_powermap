import type { ExternalServiceMeta } from "../types";

export const meta: ExternalServiceMeta = {
  id: "vworld",
  name: "VWorld (국토교통부 공간정보 오픈플랫폼)",
  category: "geocoding",
  consoleUrl: "https://www.vworld.kr/dev/v4api.do",
  envKeys: ["VWORLD_KEY"],
  expiry: "2026-10-08",
  dailyLimit: "사실상 무제한 (분당/초당 제한만 존재)",
  issueGuide: `1. https://www.vworld.kr 회원가입 (공공기관 무료)
2. [개발자센터] → [오픈API] → 인증키 발급 신청
3. 활용 API: 검색 API + 2D 지도 API + WFS (필지/폴리곤)
4. 등록 서비스 URL: \`*\` (와일드카드 — 모든 도메인 허용)
   ※ 운영 안정화 후 좁히기 권장
5. 발급된 인증키를 .env.local 의 VWORLD_KEY 에 등록
6. 만료 1개월 전 콘솔에서 연장 신청 (현재 만료: 2026-10-08)`,
  usageExample: `# 필지 폴리곤 (PNU 단건)
GET https://api.vworld.kr/req/wfs?KEY=\${VWORLD_KEY}
  &SERVICE=WFS&REQUEST=GetFeature&TYPENAME=lp_pa_cbnd_bonbun
  &FILTER=<Filter><PropertyIsEqualTo>...</PropertyIsEqualTo></Filter>

# 행정구역 폴리곤
GET .../wfs?TYPENAME=lt_c_adri  (리)
GET .../wfs?TYPENAME=lt_c_ademd (읍면동)`,
  notes: `- ⚠️ **만료일 D-day 주시**: 2026-10-08 = 약 D-166 (작성 시점 기준)
- Referer 헤더 검증: 등록한 URL 외 호출 차단 → 브라우저 직접 호출 시 CORS 막힘 → 반드시 API Route 경유
- "기타지역" 같은 비표준 주소는 카카오와 동일하게 실패 가능
- 만료 시 모든 필지/폴리곤/지오코딩 fallback 마비 — 갱신 까먹지 말 것`,
};
