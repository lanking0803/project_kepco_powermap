import type { ExternalServiceMeta } from "../types";

export const meta: ExternalServiceMeta = {
  id: "onbid",
  name: "캠코 온비드 — 부동산 공매 정보 서비스",
  category: "data.go.kr",
  consoleUrl:
    "https://www.data.go.kr/iim/api/selectAPIAcountView.do?publicDataDetailPk=uddi:35a76c3c-9712-4c9a-bf80-a78b25b9d3b8",
  envKeys: ["DATA_GO_KR_KEY"],
  expiry: "2028-04-25",
  dailyLimit: "100,000건/일 (운영계정, 2026-04-25 전환)",
  issueGuide: `1. https://www.data.go.kr → "한국자산관리공사_차세대 온비드 부동산 물건상세 조회서비스" 활용신청
2. 추가로 "OnbidRlstListSrvc2" (목록 조회) 도 함께 신청
3. 자동승인 → 즉시 사용
4. 운영계정 전환:
   - 활용사례 입력 (활용사례명, 분류체계, 서비스URL, 서비스설명, 서비스 화면 캡처 1장)
   - 자동승인 → 100,000건/일로 즉시 상향
5. 인증키는 DATA_GO_KR_KEY 공유`,
  usageExample: `# 부동산 물건 목록
GET https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2
  ?serviceKey=\${DATA_GO_KR_KEY}
  &resultType=json
  &prptDivCd=10           # 10=부동산
  &pvctTrgtYn=N           # 공고일 기준 N=현재진행
  &pageNo=1&numOfRows=100

# 부동산 물건 상세
GET https://apis.data.go.kr/B010003/OnbidRlstDtlSrvc2/getRlstDtlInf2
  ?serviceKey=\${DATA_GO_KR_KEY}
  &cltrNo=...             # 물건관리번호
  &plnmNo=...             # 공고관리번호`,
  notes: `- 응답에 **지번PNU코드 (ltnoPnu) 19자리** 제공 — ⚠️ 단, 산구분(11번째 자리) 표기가 비표준
  - 캠코: 일반=0, 산=1 (실측 500건 샘플 기준 일반 88.6% / 산 11.2%)
  - 행안부 표준 / VWorld: 일반=1, 산=2
  - VWorld 직접 매칭률 0% → 우리는 lib/onbid/pnu-fix.ts 의 pnuFromOnbidItem 으로 표준 PNU 재구성 후 사용 (실측 100% 매칭)
- 압류재산만 현재 30,178건 진행 중 (정기 공매 + 일별 갱신)
- 명세 docx → 텍스트 보존: docs/api_specs/온비드_공매/_extract.txt / _extract_상세.txt
- 호출 테스트 스크립트: crawler/test_onbid.py + web/scripts/test-onbid-*.ts (env 사용)
- 영업 활용: 시세 대비 할인율 노출 + 사진/감정평가서 PDF (의뢰자 의도 — 토지 저가 매입 기회 발굴)`,
};
