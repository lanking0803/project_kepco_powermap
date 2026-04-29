import type { ExternalServiceMeta } from "../types";

export const meta: ExternalServiceMeta = {
  id: "law-go-kr",
  name: "법제처 — 국가법령정보 OPEN API (자치법규)",
  category: "law.go.kr",
  consoleUrl: "https://open.law.go.kr/",
  envKeys: ["LAW_OC"],
  expiry: null,
  dailyLimit: "일 1만건 (자치법규 카테고리)",
  issueGuide: `1. https://open.law.go.kr 회원가입
2. 마이페이지 → "OPEN API 신청" → 호출 IP 또는 도메인 등록 (필수)
3. OC 키 = 가입 이메일 prefix 가 그대로 사용됨 (예: hicor@naver.com → OC=hicor)
4. 운영 배포 시 Vercel outbound IP 또는 sunlap.kr 도메인 추가 등록 필요`,
  usageExample: `# 자치법규 검색 (제목 매칭)
GET https://www.law.go.kr/DRF/lawSearch.do
  ?OC=\${LAW_OC}
  &target=ordin
  &type=XML
  &query=충청남도 도시계획
  &display=20

# 자치법규 본문 조회
GET https://www.law.go.kr/DRF/lawService.do
  ?OC=\${LAW_OC}
  &target=ordin
  &MST=\${자치법규일련번호}
  &type=HTML`,
  notes: `- ⚠️ **검색은 제목(자치법규명) 매칭만 지원** — section=bdyText 파라미터 무시됨, 항상 ordinNm 으로 회신
- ⚠️ **org 파라미터(지자체기관명) 무시됨** — query 에 지자체명을 직접 포함시켜야 함
- ⚠️ **IP 등록 필수** — 미등록 IP 호출 시 "사용자 정보 검증에 실패" 응답
- 일반시는 \`도시계획 조례\`, 군은 \`군계획 조례\` 식으로 명칭 다름
- 상세링크는 응답의 \`자치법규상세링크\` 필드 (자체 OC 포함된 URL) 또는 MST 로 lawService.do 직접 조립
- 검증된 검색 패턴: \`{광역명} 도시계획\` + \`{기초명} 도시계획\` (군이면 \`군계획\`)
- HTTP 사용 (HTTPS 도 응답하나 가이드 PDF 는 HTTP 기준)`,
  sampleRequest: {
    method: "GET",
    url: "http://www.law.go.kr/DRF/lawSearch.do",
    description: "자치법규 검색 (제목 매칭) — 광역+기초 도시계획 조례 찾기",
    fixedQuery: {
      OC: "{LAW_OC}",
      target: "ordin",
      type: "XML",
      display: "20",
    },
    inputs: [
      {
        name: "query",
        type: "string",
        required: true,
        sample: "충청남도 도시계획",
        description: "검색어 — '광역명 도시계획' 또는 '기초명 도시계획/군계획' 패턴",
      },
    ],
  },
};
