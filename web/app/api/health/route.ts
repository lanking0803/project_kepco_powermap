/**
 * Supabase 연결 헬스체크
 * GET /api/health → { ok: true, project: "..." }
 * Phase 3 이후엔 제거 예정
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "Supabase auth.admin.listUsers (가장 안전한 헬스체크 호출)",
  cache: "no-store",
  auth: "none",
  inputs: [],
  outputSchema: "{ ok: true, url: string, userCount: number } | { ok: false, error }",
  externalDeps: ["supabase"],
  notes:
    "Supabase 연결 정상 여부 확인용. Phase 3 이후 제거 예정. 인증 없이 호출 가능 — 운영 모니터링용.",
};

export async function GET() {
  try {
    const supabase = createAdminClient();
    // 가장 안전한 호출: auth.users 카운트 (admin 권한 필요)
    const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1 });
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      userCount: data.users.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
