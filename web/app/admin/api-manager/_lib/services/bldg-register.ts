import type { ExternalServiceMeta } from "../types";

export const meta: ExternalServiceMeta = {
  id: "bldg-register",
  name: "국토부 건축HUB — 건축물대장 정보 서비스",
  category: "data.go.kr",
  consoleUrl: "https://www.data.go.kr/data/15044713/openapi.do",
  envKeys: ["DATA_GO_KR_KEY"],
  expiry: "2028-04-25",
  dailyLimit: "운영계정 (2026-04-25 전환, 정확 한도는 마이페이지 확인)",
  issueGuide: `1. https://www.data.go.kr → "건축HUB 건축물대장 정보 서비스" 활용신청
2. 자동승인 → 즉시 사용 (개발계정)
3. 운영계정 전환 (2026-04-25 완료):
   - 활용신청 상세 → "운영계정 활용신청"
   - 활용사례 정보 입력 → 자동승인 → 한도 상향
4. 인증키는 DATA_GO_KR_KEY 공유 (별도 발급 X)
5. 만료 만료예정일 2028-04-25 — 만료 전 콘솔에서 연장`,
  usageExample: `# 표제부 (메인 건물)
GET https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo
  ?serviceKey=\${DATA_GO_KR_KEY}
  &sigunguCd=11680    # 시군구 5자리
  &bjdongCd=10300     # 법정동 5자리
  &platGbCd=0         # 0=일반/1=산
  &bun=0073&ji=0001   # 본번/부번 4자리`,
  notes: `- ⚠️ **트러블슈팅**: 401 Unauthorized 의 진짜 원인은 키 문제가 아니라 **존재하지 않는 시군구/법정동 조합**
  → 의심되는 주소 시도 전 검증된 주소(서울 강남 삼성동 159)로 200 OK 먼저 확인
- **결정적 한계**: 비닐하우스/간이 슬레이트 축사는 가설건축물 → 미등록 (대부분 안 잡힘)
- 등록 잘 됨: 유리온실(100평↑), 콘크리트/철골 축사, 공장/창고/일반건물
- 표제부(getBrTitleInfo) + 총괄표제부(getBrRecapTitleInfo) 가 메인 — 7개 오퍼레이션 중 표제부만 우선 도입
- 응답 = 78 필드, 영업가치 22개만 발췌 정규화 (lib/building-hub/title.ts)
- 한 지번에 여러 동(부속건축물 등) 가능 → rows 배열`,
  sampleRequest: {
    method: "GET",
    url: "https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo",
    description: "건축물대장 표제부 — 검증된 주소: 서울 강남 역삼동 736 (200 OK + 데이터 1건+)",
    fixedQuery: {
      serviceKey: "{DATA_GO_KR_KEY}",
      _type: "json",
      numOfRows: "10",
      pageNo: "1",
    },
    inputs: [
      {
        name: "sigunguCd",
        type: "string",
        required: true,
        sample: "11680",
        description: "시군구 5자리 (서울 강남구=11680)",
      },
      {
        name: "bjdongCd",
        type: "string",
        required: true,
        sample: "10100",
        description: "법정동 5자리 (역삼동=10100)",
      },
      {
        name: "platGbCd",
        type: "string",
        required: true,
        sample: "0",
        description: "0=일반 / 1=산",
      },
      {
        name: "bun",
        type: "string",
        required: true,
        sample: "0736",
        description: "본번 4자리 (zero-pad)",
      },
      {
        name: "ji",
        type: "string",
        required: true,
        sample: "0000",
        description: "부번 4자리 (zero-pad, 부번없음=0000)",
      },
    ],
  },
};
