/**
 * GET /api/map-summary
 * - 지도 마커용 Light 데이터 (마을 단위 집계)
 * - 인증된 사용자만 접근
 * - kepco_map_summary (Materialized View) 전체 반환
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MapSummaryResponse, MapSummaryRow } from "@/lib/types";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "DB MV (kepco_map_summary, 페이지네이션 1000행씩 전량 수집)",
  cache: "no-store",
  auth: "user",
  inputs: [],
  outputSchema:
    "{ rows: MapSummaryRow[], total: number, generatedAt: string }",
  externalDeps: ["supabase"],
  notes:
    "지도 마커 초기 로드용 light 데이터. PostgREST 1000행 제한 우회 위해 페이지네이션 전량 수집. no-store — 수집/지오코딩 즉시 반영 (캐시 시 '마커 0' 사고 사례).",
};

export async function GET() {
  // 인증 체크
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  // service_role로 조회 (RLS 우회 — Materialized View는 RLS 적용 어려움)
  // PostgREST / Supabase JS 는 기본 1000행 제한이 있어 silently 잘림 → 페이지네이션으로 전량 수집.
  const supabase = createAdminClient();
  const PAGE = 1000;
  const rows: MapSummaryRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("kepco_map_summary")
      .select(
        "bjd_code, geocode_address, lat, lng, total, subst_no_cap, mtr_no_cap, dl_no_cap, addr_do, addr_si, addr_gu, addr_dong, addr_li, subst_names, dl_names, subst_remaining_kw, mtr_remaining_kw, dl_remaining_kw, max_remaining_kw"
      )
      .range(from, from + PAGE - 1);

    if (error) {
      console.error("[map-summary] 조회 실패", error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }
    const chunk = (data ?? []) as MapSummaryRow[];
    rows.push(...chunk);
    if (chunk.length < PAGE) break; // 마지막 페이지
  }

  const response: MapSummaryResponse = {
    rows,
    total: rows.length,
    generatedAt: new Date().toISOString(),
  };

  // CDN/브라우저 캐시 금지 — 수집/지오코딩 직후 즉시 반영되어야 하고,
  // cached 응답으로 인해 "마커 0" 증상이 발생한 사례 있음 (docs/개발계획.md §4-1 참고)
  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
