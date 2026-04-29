import type { ExternalServiceMeta } from "../types";

export const meta: ExternalServiceMeta = {
  id: "rtms-nrg",
  name: "국토부 RTMS — 상업업무용 부동산 매매 실거래가",
  category: "data.go.kr",
  consoleUrl: "https://www.data.go.kr/data/15057275/openapi.do",
  envKeys: ["DATA_GO_KR_KEY"],
  expiry: "2028-04-25",
  dailyLimit: "1,000,000건/일 (운영계정, 2026-04-25 전환)",
  issueGuide: `1. https://www.data.go.kr 로그인 → 마이페이지
2. "국토교통부_상업업무용 부동산 매매 실거래가 자료" 검색 → 활용신청
3. 자동승인 → 즉시 사용 가능
4. 운영계정 전환 절차는 RTMS 토지와 동일 (자동승인 100만/일)
5. 인증키는 DATA_GO_KR_KEY 공유 (별도 발급 X)`,
  usageExample: `GET https://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade
  ?serviceKey=\${DATA_GO_KR_KEY}
  &LAWD_CD=11680
  &DEAL_YMD=202604
Headers:
  User-Agent: Mozilla/5.0 (compatible; SUNLAP/1.0)`,
  notes: `- 토지 RTMS 와 동일한 호출 패턴 (User-Agent + XML + 시군구·월 fan-out)
- 응답 필드: 토지보다 풍부 — buildingType (일반/집합), buildingUse, buildingAr, floor, plottageAr 등
- **마스킹 정책 (실측)**:
  - buildingType="집합" → jibun 정확 노출
  - buildingType="일반" → jibun 마스킹
- **공장/창고 매매는 nrg 에 미포함** — 토지매매(rtms-land) 의 "공장용지" 지목 참조
- 옥상 태양광 사업자 관점: 평당가는 buildingAr 기준 (대지 X, 건물면적)`,
  sampleRequest: {
    method: "GET",
    url: "https://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade",
    description: "상업업무용 부동산 매매 실거래가 — 시군구 + 거래월",
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
        sample: "11680",
        description: "시군구 5자리 (서울 강남구=11680)",
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
