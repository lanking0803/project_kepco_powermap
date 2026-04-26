/**
 * POST /api/refresh-mv
 * Materialized View 수동 새로고침 — 새로고침 버튼에서 호출.
 *
 * 함수 측에서 60초 cooldown + advisory lock + 5분 statement_timeout 으로
 * 동시성/타임아웃을 모두 흡수하므로, 라우트는 RPC 결과를 그대로 전달한다.
 *
 * 응답 형식:
 *   { ok: true, skipped: false }                  — 실제 REFRESH 수행
 *   { ok: true, skipped: true,  reason: ... }     — cooldown 또는 진행중
 *   { ok: false, error: ... }                     — 함수 실패
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

// REFRESH 가 분 단위로 길어질 수 있으므로 라우트 timeout 도 함께 풀어둔다.
export const maxDuration = 300;

export const meta: EndpointMeta = {
  source: "DB RPC refresh_kepco_summary — Materialized View 수동 새로고침",
  cache: "no-store",
  auth: "user",
  inputs: [],
  outputSchema:
    "{ ok: true, skipped: false } | { ok: true, skipped: true, reason, age_sec? } | { ok: false, error }",
  externalDeps: ["supabase"],
  dangerous: true,
  dangerNote:
    "MV 전체 재구축 — 분 단위 소요. 동시 요청은 RPC 측 60s cooldown + advisory lock 으로 흡수되지만, 진행중 호출은 의미 없으니 cooldown 표시 확인.",
  notes:
    "사이드바 새로고침 버튼에서 호출. RPC 측에서 60s cooldown + advisory lock + 5분 statement_timeout. maxDuration=300 (라우트 timeout).",
};

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("refresh_kepco_summary");

  if (error) {
    console.error("[refresh-mv] 실패:", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  // 함수가 jsonb 로 { ok, skipped, reason?, age_sec? } 반환
  return NextResponse.json(data ?? { ok: true });
}
