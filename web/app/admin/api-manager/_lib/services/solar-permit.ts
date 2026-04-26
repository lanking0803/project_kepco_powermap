import type { ExternalServiceMeta } from "../types";

export const meta: ExternalServiceMeta = {
  id: "solar-permit",
  name: "전국 태양광 발전소 전기사업 허가 정보 (NIA)",
  category: "data.go.kr",
  consoleUrl: "https://www.data.go.kr/data/15107742/standard.do",
  envKeys: ["DATA_GO_KR_KEY"],
  expiry: "2028-04-25",
  dailyLimit: "운영계정 (2026-04-25 전환, 정확 한도는 마이페이지 확인)",
  issueGuide: `1. https://www.data.go.kr → "전국태양광발전소전기사업허가정보표준데이터" 활용신청
2. 자동승인 → 즉시 사용 (개발계정 1,000건/일)
3. 운영계정 전환 (2026-04-25 완료):
   - 활용신청 상세 → "운영계정 활용신청" → 자동승인
4. 인증키는 DATA_GO_KR_KEY 공유 (별도 발급 X)
5. 만료예정일 2028-04-25 — 만료 전 콘솔 연장`,
  usageExample: `# 페이지네이션만 작동 (검색 필터 미지원, 아래 ⚠ 참고)
GET https://api.data.go.kr/openapi/tn_pubr_public_solar_gen_flct_api
  ?serviceKey=\${DATA_GO_KR_KEY}
  &type=json
  &pageNo=1&numOfRows=100
Headers:
  User-Agent: Mozilla/5.0
  Accept: application/json

# 응답 17 필드 (camelCase, 명세 PDF 의 대문자 표기와 다름) — 정규화: lib/solar-permit/by-page.ts
# 주요: solarGenFcltNm / lctnLotnoAddr / latitude / longitude
#       capa / oprtngSttsSeNm / instlDtlPstnSeNm / prmsnYmd / instlYr ...`,
  notes: `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ 검증 결과 (2026-04-26 직접 호출 검증)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 검색 필터 전부 미지원 (명세 PDF 표기와 다름)
   - LCTN_LOTNO_ADDR / LCTN_ROAD_NM_ADDR / SOLAR_GEN_FCLT_NM
     → 응답에 있는 정확한 값을 그대로 입력해도 NODATA
   - LATITUDE / LONGITUDE → byte 단위 정확 일치 시에만 매칭 (실용성 0)
   - 한글 파라미터명 → INVALID_REQUEST_PARAMETER_ERROR

2. 작동하는 입력 = pageNo + numOfRows + type 만
   - 전국 12만 행 (totalCount=121,015)
   - 122 페이지 × 1000건 = 전수 다운로드 가능

3. 응답 필드 = camelCase
   - 명세 PDF: LCTN_LOTNO_ADDR (대문자)
   - 실제 응답: lctnLotnoAddr (camelCase)
   - 정규화는 wrapper (lib/solar-permit/by-page.ts) 가 처리

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 영업 활용 패턴 (Phase 3 정식 작업)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

이 API 는 검색 미지원이라 사용자 클릭 시점 호출 불가.
실제 영업 기능은 "수집형 패턴" 으로 구현해야 함:

[수집] GitHub Actions 월 1회 cron
   → 122 페이지 전수 다운로드 (~7분, 운영계정 100K/일 충분)
   → Supabase solar_permits 테이블 적재
   → PostGIS GIST 인덱스 (geom GEOGRAPHY)

[검색] 사용자 PNU 클릭
   → 우리 DB ST_DWithin(geom, point, 50m) 쿼리
   → 결과: 50m 반경 시설 목록 (외부 API 호출 0, 1ms 이하)

⚠ 견적: Phase 3 정식 작업 = ① 태양광 설치여부 표시 (150만 / 3~4주, 견적_3차_데이터연계.md)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 본 atomic endpoint (/api/solar-permits/by-page) 의 역할
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

페이지 1건씩 받아오는 최소 wrapper. 용도:
  (1) API 살아있나 라이브 검증 (관리자 페이지)
  (2) Phase 3 정식 시 수집기의 기반 코드 (그대로 재사용)

⛔ 사용자 영업 화면용 X. 영업 endpoint 는 Phase 3 시점에 별도 신설:
  - /api/solar-permits/by-pnu      (같은 PNU 매칭)
  - /api/solar-permits/near-point  (좌표 50m 반경)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 데이터 한계
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- 3 kW 이하 자가발전 누락 (허가 대상 아님 — 축사/온실은 30kW↑ 라 영향 적음)
- 응답 = JSON (type=json) 또는 XML (기본). 우리는 type=json 명시
- numOfRows 최대 1,000
- 일부 필드 sentinel 값: instlYr=1900 (실제 미상), lctnRoadNmAddr="" (도로명 없는 경우)
- 데이터 갱신 주기: API 측에서 수시 — crtrYmd 필드로 데이터 기준일 확인 가능`,
};
