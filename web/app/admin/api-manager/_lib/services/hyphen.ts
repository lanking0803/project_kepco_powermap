import type { ExternalServiceMeta } from "../types";

export const meta: ExternalServiceMeta = {
  id: "hyphen",
  name: "Hyphen — 부동산 법원경매 정보(경매다)",
  category: "hyphen",
  consoleUrl: "https://hyphen.im/mypage/my-bizmoney",
  envKeys: ["HYPHEN_HKEY", "HYPHEN_USER_ID"],
  // ⚠️ 의뢰자 비즈머니 결제일 — 만료 7일 전부터 헬스체크/관리자 화면에서 경고.
  // 의뢰자가 결제 갱신할 때마다 수동으로 갱신 필요.
  expiry: "2026-06-02",
  dailyLimit:
    "TR슬림 월 10만원 정액 + 호출당 종량 (호출 단가 비공개. 비즈머니 110,000원 충전 시 첫 결제분 포함)",
  issueGuide: `1. https://hyphen.im 회원가입 (의뢰자 계정 anhong7749 사용)
2. 마이페이지 → 비즈머니 충전 (TR슬림 1개월 = 10만원)
3. API 마켓 → "부동산 법원경매 정보(경매다)" 상품 선택 → 신청
4. 자동승인 → "API 마켓 > 상품 상세" 에서 Hkey 발급
5. 환경변수 등록:
   - HYPHEN_HKEY = (Hkey 값)
   - HYPHEN_USER_ID = (회원 ID, 예: anhong7749)
   - web/.env.local + Vercel 환경변수 둘 다 등록
6. 결제 만료 → API 자동 차단 (errCd=HDM006). UI 가 사용자에게 결제 안내 배너 표시.
   → 의뢰자가 직접 결제 갱신 필요. SECRETS.local.md 의 expiry 갱신.`,
  usageExample: `# 진행물건검색 (면 단위 sweep — 우리 by-pnu 흐름의 기반)
POST https://api.hyphen.im/au0147001252
Headers:
  Content-Type: application/json
  Hkey: \${HYPHEN_HKEY}
  User-Id: \${HYPHEN_USER_ID}
  Hyphen-Gustation: Y
Body:
  {
    "sido": "41",          # PNU 앞 2자리 (행안부 표준)
    "gugun": "41570",      # PNU 앞 5자리
    "dong": "4157034033",  # PNU 앞 10자리 (실제로는 면 단위 매칭)
    "page": "1"
  }

# 사건상세보기 (단건 — product_id = 응답의 경매번호)
POST https://api.hyphen.im/au0147001254
Body: { "product_id": "1054811" }`,
  notes: `- ⚠️ **유료 API** — 의뢰자가 매월 직접 비즈머니 충전 (개발자 청구 X 합의)
- ⚠️ **결제 만료 시 errCd=HDM006** ("UserId 또는 HKey가 존재하지 않습니다") 응답.
  UI 가 \`apiStatus="auth_failed"\` 배너로 의뢰자에게 결제 안내.
- ⚠️ **명세서 응답 필드명 부정확**: 명세는 "get○○" 인데 실제 응답은 "○○" (get 접두사 없음).
  실호출 검증 결과 기준으로 코드 작성됨 (lib/hyphen/types.ts).
- ⚠️ **사건번호코드 ≠ product_id** — 상세 호출엔 응답의 \`경매번호\` 사용 (사건번호코드 X).
- 검증 결과: docs/api_specs/하이픈_부동산법원경매정보/_test_v*.json (17건)
- 페이지당 10건 고정 → 면 단위 sweep 시 totalpage 만큼 병렬 호출 (≤ 20페이지 cap)
- 응답에 종결 매물(매각/취하)도 섞여 옴 — UI 에서 진행상태 배지로 구분
- dong 필터는 행안부 리(里) 코드 입력해도 실제로는 "면(面) 단위" 매칭`,
  sampleRequest: {
    method: "POST",
    url: "https://api.hyphen.im/au0147001246",
    description:
      "시도코드조회 — 가벼운 헬스체크용 (body 없음). errCd=200 정상 / HDM006 인증실패",
    headers: {
      "Content-Type": "application/json",
      Hkey: "{HYPHEN_HKEY}",
      "User-Id": "{HYPHEN_USER_ID}",
      "Hyphen-Gustation": "Y",
    },
  },
};
