/**
 * GET /api/capa/by-jibun?bjd_code=...&jibun=...
 *
 * Atomic endpoint — 지번 단위 KEPCO 용량 + 행정구역 메타.
 *
 * 응답 (성공):
 *   { ok, bjd_code, jibun, rows: KepcoDataRow[], total, meta: AddrMeta | null }
 *
 * meta = bjd_master 의 sep_1~5 (헤더 주소 표시용). bjd_code 가 sentinel 이거나
 *        매칭 실패 시 null — 호출처가 parcel 응답으로 fallback.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AddrMeta, KepcoDataRow } from "@/lib/types";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "DB (Supabase: kepco_capa + bjd_master)",
  cache: "no-store",
  auth: "user",
  inputs: [
    {
      name: "bjd_code",
      type: "string",
      required: true,
      sample: "4673025025",
      description: "법정동 코드 10자리",
    },
    {
      name: "jibun",
      type: "string",
      required: true,
      sample: "20-1",
      description: "지번 (예: 20, 20-1, 산5-3)",
    },
  ],
  outputSchema:
    "{ ok, bjd_code, jibun, rows: KepcoDataRow[], total, meta: AddrMeta | null }",
  externalDeps: [],
  notes:
    "exact match 만 — fallback 없음. KEPCO 미수집 지번은 빈 rows 반환. meta 는 bjd_master 의 sep_1~5 (헤더 주소 표시용 보조 데이터).",
};

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  const bjdCode = request.nextUrl.searchParams.get("bjd_code");
  const jibun = request.nextUrl.searchParams.get("jibun");
  if (!bjdCode || !jibun) {
    return NextResponse.json(
      { ok: false, error: "bjd_code, jibun 파라미터 모두 필요합니다." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const [capaRes, metaRes] = await Promise.all([
    supabase
      .from("kepco_capa")
      .select("*")
      .eq("bjd_code", bjdCode)
      .eq("addr_jibun", jibun),
    supabase
      .from("bjd_master")
      .select("sep_1,sep_2,sep_3,sep_4,sep_5")
      .eq("bjd_code", bjdCode)
      .maybeSingle(),
  ]);

  if (capaRes.error) {
    console.error("[capa/by-jibun] 조회 실패", capaRes.error);
    return NextResponse.json(
      { ok: false, error: capaRes.error.message },
      { status: 500 }
    );
  }

  const rows = (capaRes.data ?? []) as KepcoDataRow[];
  const m = metaRes.data;
  const meta: AddrMeta | null = m
    ? {
        sep_1: m.sep_1 || null,
        sep_2: m.sep_2 || null,
        sep_3: m.sep_3 || null,
        sep_4: m.sep_4 || null,
        sep_5: m.sep_5 || null,
      }
    : null;

  return NextResponse.json(
    {
      ok: true,
      bjd_code: bjdCode,
      jibun,
      rows,
      total: rows.length,
      meta,
    },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
}
