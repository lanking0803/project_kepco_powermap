/**
 * GET /api/capa/by-bjd?bjd_code=...
 *
 * Atomic endpoint — 마을(리/읍면동) bjd_code 기준 KEPCO 용량 전체 조회.
 * RPC: get_location_detail (kepco_capa 의 SETOF, ORDER BY 캡슐화).
 *
 * 사용처:
 *   - 지도 마커 클릭 — 마을의 모든 지번/시설 raw 데이터 펼치기
 *
 * 응답:
 *   { ok: true, bjd_code, rows: KepcoDataRow[], total }
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { KepcoDataRow } from "@/lib/types";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "DB RPC get_location_detail(bjd_code)",
  cache: "no-store",
  auth: "user",
  inputs: [
    {
      name: "bjd_code",
      type: "string",
      required: true,
      sample: "4673025025",
      description: "행안부 법정동 코드 10자리",
    },
  ],
  outputSchema: "{ ok, bjd_code, rows: KepcoDataRow[], total }",
  externalDeps: ["supabase"],
  notes:
    "마을(리/읍면동) 의 모든 지번/시설 raw rows. 마을 마커 클릭 → 상세 모달 (lazy fetch). 평균 383행/P90 643행/max 1524행 → gzip ~30KB.",
};

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  const bjdCode = (request.nextUrl.searchParams.get("bjd_code") || "").trim();
  if (!/^\d{10}$/.test(bjdCode)) {
    return NextResponse.json(
      { ok: false, error: "bjd_code 는 10자리 숫자여야 합니다." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("get_location_detail", {
    p_bjd_code: bjdCode,
  });

  if (error) {
    console.error("[capa/by-bjd] RPC 실패", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as KepcoDataRow[];
  return NextResponse.json(
    { ok: true, bjd_code: bjdCode, rows, total: rows.length },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
}
