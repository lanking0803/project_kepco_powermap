import type { ExternalServiceMeta } from "../types";

export const meta: ExternalServiceMeta = {
  id: "kakao",
  name: "Kakao Developers",
  category: "geocoding",
  consoleUrl: "https://developers.kakao.com/console/app/1424714",
  envKeys: ["NEXT_PUBLIC_KAKAO_JS_KEY", "KAKAO_REST_KEY"],
  expiry: null,
  dailyLimit: "300,000건/일 (지오코딩 / 역지오코딩 각각)",
  issueGuide: `1. https://developers.kakao.com 접속 → Google 로그인
2. 앱 ID 1424714 (이름: kepco_web) 선택 또는 새 앱 생성
3. 좌측 [플랫폼] → Web 플랫폼 등록 → 도메인 추가
   - http://localhost:3000 (개발)
   - https://sunlap.kr (운영)
4. 좌측 [앱 키] → JavaScript 키, REST API 키 복사
5. .env.local 에 등록
   - NEXT_PUBLIC_KAKAO_JS_KEY=...
   - KAKAO_REST_KEY=...`,
  usageExample: `# 주소 → 좌표 (지오코딩)
GET https://dapi.kakao.com/v2/local/search/address?query=서울 강남대로 1
Headers:
  Authorization: KakaoAK \${KAKAO_REST_KEY}`,
  notes: `- JavaScript 키는 브라우저 노출 OK — 콘솔 도메인 화이트리스트로 보호됨
- REST 키는 절대 클라이언트 노출 X → 반드시 API Route 경유
- 일 한도 초과 시 자동 차단 (과금 X), 자정 지나면 복구
- 한국 주소 정확도 가장 높음 — 1순위 지오코더`,
};
