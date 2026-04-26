import type { ExternalServiceMeta } from "../types";

export const meta: ExternalServiceMeta = {
  id: "supabase",
  name: "Supabase (Postgres + Auth + Storage)",
  category: "infra",
  consoleUrl: "https://supabase.com/dashboard/project/wtbwgjejfrrwgbzgcdjd",
  envKeys: [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ],
  expiry: null,
  dailyLimit: "DB 500MB · egress 5GB/월 · API 요청 무제한",
  issueGuide: `1. https://supabase.com 회원가입 → 새 프로젝트 생성
2. Region: Northeast Asia - Seoul 권장
3. DB 패스워드 설정 (강한 패스워드, SECRETS.local.md 기록)
4. Settings → API:
   - Project URL → NEXT_PUBLIC_SUPABASE_URL
   - anon public → NEXT_PUBLIC_SUPABASE_ANON_KEY (브라우저 노출 OK)
   - service_role → SUPABASE_SERVICE_ROLE_KEY (서버 전용, 절대 클라이언트 X)
5. .env.local + Vercel 환경변수 양쪽 등록
6. 휴면 방지 cron 설정 (주 1회 ping, 7일 미접속 시 일시정지)`,
  usageExample: `# 서버 컴포넌트
import { createAdminClient } from "@/lib/supabase/admin";
const supabase = createAdminClient();
await supabase.from("kepco_capa").select("*").eq("bjd_code", "...");

# 클라이언트 (브라우저)
import { createClient } from "@/lib/supabase/client";
const supabase = createClient();
const { data: { user } } = await supabase.auth.getUser();`,
  notes: `- 프로젝트명: kepco-web-map (Project ID: wtbwgjejfrrwgbzgcdjd)
- 핵심 테이블: kepco_addr / kepco_capa / kepco_map_summary(MV) / bjd_master / crawl_jobs / user_roles
- DB 최적화 이력 (2026-04-11): 110MB → 53MB (52% 감소) — row_hash 도입 + 불필요 인덱스 8개 제거
- 좌표 저장 정책: kepco_addr.lat/lng = 리 단위 / 지번 좌표는 Vercel KV TTL 3일 (geocode_cache 폐기됨)
- ⚠️ 휴면 정책: 7일 미접속 → 일시정지. cron ping 으로 방지 필수`,
};
