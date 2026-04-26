import type { ExternalServiceMeta } from "../types";

export const meta: ExternalServiceMeta = {
  id: "kepco",
  name: "한국전력공사 — 배전선로 여유용량 (비공식 API)",
  category: "scraping",
  consoleUrl: "https://online.kepco.co.kr",
  envKeys: [],
  expiry: null,
  dailyLimit: "비공식 (차단 위험) — User-Agent 랜덤 + 세션 재생성 + 점진적 백오프",
  issueGuide: `**공식 API 없음**. 한전 홈페이지 내부 API 를 역호출하는 방식.

별도 키 발급/계정 등록 불필요. 단, 차단 방지 대책 적용 필수:
1. User-Agent 풀 (7개 브라우저 UA) 랜덤 회전
2. 2,000건마다 세션 재생성
3. 1,000건마다 30초 휴식
4. 연속 에러 시 60~180초 점진적 백오프
5. delay 조정 (0.15초 ~ 2.0초, UI 에서 설정)

GitHub Actions 러너에서 크롤링 실행 — IP 차단 시 러너 IP 변경으로 자연 해제`,
  usageExample: `# 주소 계층 조회 (KEPCO 내부 API)
POST https://online.kepco.co.kr/EWM092D00SJ.do
Content-Type: application/json
Headers:
  Referer: https://online.kepco.co.kr/...
  User-Agent: Mozilla/5.0 ...

Body: { "gbn": "init" | "0" | "1" | "2" | "3", ... }`,
  notes: `- 사용자가 직접 호출하는 endpoint 없음 (모두 GitHub Actions 크롤러가 호출)
- 단, /api/admin/crawl/regions 가 KEPCO 주소 계층 API 를 프록시 (관리자 화면 드롭다운용)
- 동시 3개 스레드 시 delay 0.5초 이상 권장
- 연속 10회 에러 시 자동 중단 (TooManyErrorsException)
- 크롤링 아키텍처: docs/CRAWLING.md`,
};
