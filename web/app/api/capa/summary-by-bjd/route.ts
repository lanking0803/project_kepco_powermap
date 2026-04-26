/**
 * GET /api/capa/summary-by-bjd?bjd_code=...
 *
 * Atomic endpoint — 마을(리/읍면동) 카드용 시설별 여유·부족 집계.
 * RPC: get_location_summary (kepco_capa GROUP COUNT FILTER, 1행 반환).
 *
 * 사용처:
 *   - 마커 클릭 시 카드만 그릴 때 (raw rows 대신, ~80B)
 *   - 상세 모달은 /api/capa/by-bjd 별도 호출 (lazy fetch)
 *
 * 응답:
 *   { ok: true, bjd_code, summary: KepcoCapaSummary }
 *
 * 변환:
 *   DB 는 flat 7컬럼 (subst_avail/short, mtr_avail/short, dl_avail/short, total)
 *   → 클라이언트는 시설별 중첩 (subst.{avail,short}) 으로 받음.
 *   카드가 시설 단위로 순회하기 좋음.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { KepcoCapaSummary } from "@/lib/types";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "DB RPC get_location_summary(bjd_code) — flat 7컬럼 GROUP COUNT FILTER",
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
  outputSchema:
    "{ ok, bjd_code, summary: { total, subst:{avail,short}, mtr:{avail,short}, dl:{avail,short} } }",
  externalDeps: ["supabase"],
  notes:
    "마커 클릭 시 카드만 그릴 때 (~80B, raw rows 대비 99% 절감). DB flat → 시설별 중첩 객체 변환. 모달 펼칠 때 /api/capa/by-bjd 별도 호출.",
};

interface SummaryRow {
  total: number;
  subst_avail: number;
  subst_short: number;
  mtr_avail: number;
  mtr_short: number;
  dl_avail: number;
  dl_short: number;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 },
    );
  }

  const bjdCode = (request.nextUrl.searchParams.get("bjd_code") || "").trim();
  if (!/^\d{10}$/.test(bjdCode)) {
    return NextResponse.json(
      { ok: false, error: "bjd_code 는 10자리 숫자여야 합니다." },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("get_location_summary", {
    p_bjd_code: bjdCode,
  });

  if (error) {
    console.error("[capa/summary-by-bjd] RPC 실패", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  const row = (data?.[0] as SummaryRow | undefined) ?? {
    total: 0,
    subst_avail: 0,
    subst_short: 0,
    mtr_avail: 0,
    mtr_short: 0,
    dl_avail: 0,
    dl_short: 0,
  };

  const summary: KepcoCapaSummary = {
    total: row.total,
    subst: { avail: row.subst_avail, short: row.subst_short },
    mtr:   { avail: row.mtr_avail,   short: row.mtr_short   },
    dl:    { avail: row.dl_avail,    short: row.dl_short    },
  };

  return NextResponse.json(
    { ok: true, bjd_code: bjdCode, summary },
    { headers: { "Cache-Control": "no-store" } },
  );
}
