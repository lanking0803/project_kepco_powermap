import type { ExternalServiceMeta } from "../types";

export const meta: ExternalServiceMeta = {
  id: "vercel",
  name: "Vercel (호스팅 + Edge Functions + KV)",
  category: "infra",
  consoleUrl: "https://vercel.com/dashboard",
  envKeys: [],
  expiry: null,
  dailyLimit: "100 GB 대역폭/월 · 빌드 6,000분/월 · Edge 500K 호출/월 (Hobby)",
  issueGuide: `1. https://vercel.com 회원가입 (Google 소셜 로그인 권장 — hicor150010@gmail.com)
2. New Project → GitHub 리포 import: hicor150010/project_kepco_powermap
3. Root Directory: web (모노레포 — Next.js 가 web/ 하위에 있음)
4. Framework: Next.js (자동 감지)
5. 환경변수 등록 (Settings → Environment Variables):
   - NEXT_PUBLIC_KAKAO_JS_KEY / KAKAO_REST_KEY
   - VWORLD_KEY / DATA_GO_KR_KEY
   - SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY
   - GH_PAT / GITHUB_REPO / CRON_SECRET
6. 도메인: Settings → Domains → sunlap.kr 추가 (가비아 DNS 설정 필요)`,
  usageExample: `# 배포 도메인
https://kepco-powermap.vercel.app
https://sunlap.kr

# Vercel KV (Upstash)
import { kv } from "@vercel/kv";
await kv.set("key", value, { ex: 3600 });   // 1h TTL

# 환경변수 (server-side)
process.env.DATA_GO_KR_KEY`,
  notes: `- 플랜: Hobby (무료) — 한도 초과 시 Pro 업그레이드 검토
- /admin/api-manager 는 process.env.VERCEL === "1" 체크로 차단
- KV 한도: 256 MB / 10K 명령/일 (현재 지번 좌표 캐시 3일 TTL 로 사용 중)
- 빌드 환경변수가 누락되면 Next.js 가 의외의 fallback 으로 빌드됨 → 배포 후 즉시 환경변수 확인 권장
- Logs: 7일 retain (Hobby)`,
};
