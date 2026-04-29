import type { ExternalServiceMeta } from "../types";

export const meta: ExternalServiceMeta = {
  id: "rtms-land",
  name: "국토부 RTMS — 토지 매매 실거래가",
  category: "data.go.kr",
  consoleUrl: "https://www.data.go.kr/data/15126466/openapi.do",
  envKeys: ["DATA_GO_KR_KEY"],
  expiry: "2028-04-25",
  dailyLimit: "1,000,000건/일 (운영계정, 2026-04-25 전환)",
  issueGuide: `1. https://www.data.go.kr 로그인 → 마이페이지
2. 데이터 활용 → Open API → 활용신청 현황
3. "국토교통부_토지 매매 실거래가 자료" 검색 → 활용신청
4. 자동승인 → 즉시 사용 가능 (개발계정 1,000건/일)
5. 운영계정 전환:
   - 활용신청 상세 → "운영계정 활용신청" 클릭
   - 활용사례 정보 입력 (서비스URL, 설명, 화면 캡처)
   - 자동승인 → 100만건/일로 즉시 상향
6. 인증키는 다른 data.go.kr 서비스와 공유 (하나의 DATA_GO_KR_KEY)`,
  usageExample: `GET https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade
  ?serviceKey=\${DATA_GO_KR_KEY}
  &LAWD_CD=46730     # 시군구 5자리
  &DEAL_YMD=202604   # 거래월 YYYYMM
  &numOfRows=100&pageNo=1
Headers:
  User-Agent: Mozilla/5.0 (compatible; SUNLAP/1.0)`,
  notes: `- ⚠️ **User-Agent 헤더 필수** — 없으면 WAF 가 400 Request Blocked
- 응답 = XML 고정 (\`_type=json\` 무시됨) → fast-xml-parser
- 시군구 + 거래월 단위로만 조회 가능 → N개월 = N회 fan-out (Promise.all)
- 응답 jibun 끝자리 마스킹 ("3*", "10*") — 정확 매칭 불가, 통계 용도
- resultCode "03" = NO_DATA (정상, 거래 0건)
- 키 노출 시: data.go.kr 마이페이지에서 인증키 재발급 → DATA_GO_KR_KEY 갱신`,
  sampleRequest: {
    method: "GET",
    url: "https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade",
    description: "토지 매매 실거래가 — 시군구 + 거래월 단위 조회",
    fixedQuery: {
      serviceKey: "{DATA_GO_KR_KEY}",
      numOfRows: "10",
      pageNo: "1",
    },
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SUNLAP/1.0)" },
    inputs: [
      {
        name: "LAWD_CD",
        type: "string",
        required: true,
        sample: "44760",
        description: "시군구 5자리 (부여군=44760)",
      },
      {
        name: "DEAL_YMD",
        type: "string",
        required: true,
        sample: "202604",
        description: "거래월 YYYYMM",
      },
    ],
  },
};
