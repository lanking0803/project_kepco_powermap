/**
 * GET /api/capa/by-pnu?pnu=<19자리>
 *
 * Atomic endpoint — PNU 단위 KEPCO 용량 + 행정구역 메타.
 *
 * 입력: PNU 19자리 (행안부 표준, 산구분 1=일반/2=산).
 * 서버 분리:
 *   - bjd_code = PNU 앞 10자리
 *   - jibun = PNU 뒤 9자리 → 텍스트 ("36-2", "산23")
 *   - kepco_capa.addr_jibun 와 exact match (fallback 없음)
 *
 * 응답:
 *   { ok, pnu, bjd_code, jibun, rows: KepcoDataRow[], total, meta: AddrMeta | null }
 *
 * 사용처:
 *   - ParcelInfoPanel [전기] 탭 (lib/kepco/by-pnu) — 모든 진입(전기/공매/견적) 단일 입력 PNU.
 *
 * 마을(BJD) 단위 조회는 별도 endpoint:
 *   - 마을 카드:  /api/capa/summary-by-bjd
 *   - 마을 모달:  /api/capa/by-bjd
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { jibunFromPnu } from "@/lib/geo/pnu";
import type { AddrMeta, KepcoDataRow } from "@/lib/types";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "DB (Supabase: kepco_capa + bjd_master)",
  cache: "no-store",
  auth: "user",
  inputs: [
    {
      name: "pnu",
      type: "string",
      required: true,
      sample: "4417025021103950003",
      description:
        "PNU 19자리 (bjd_code 10 + 산구분 1 + 본번 4 + 부번 4). 행안부 표준 (1=일반/2=산).",
    },
  ],
  outputSchema:
    "{ ok, pnu, bjd_code, jibun, rows: KepcoDataRow[], total, meta: AddrMeta | null }",
  externalDeps: [],
  notes:
    "exact match 만 — fallback 없음. KEPCO 미수집 지번은 빈 rows. meta = bjd_master 의 sep_1~5 (헤더 주소 표시용 보조). PNU → bjd_code/jibun 분리는 lib/geo/pnu (jibunFromPnu).",
};

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 },
    );
  }

  const pnu = (request.nextUrl.searchParams.get("pnu") ?? "").trim();
  if (!/^\d{19}$/.test(pnu)) {
    return NextResponse.json(
      { ok: false, error: "PNU 형식 오류 (19자리 숫자 필요)" },
      { status: 400 },
    );
  }

  const bjdCode = pnu.slice(0, 10);
  const jibun = jibunFromPnu(pnu);
  if (!jibun) {
    return NextResponse.json(
      { ok: false, error: "PNU 에서 지번을 추출할 수 없습니다." },
      { status: 400 },
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
    console.error("[capa/by-pnu] 조회 실패", capaRes.error);
    return NextResponse.json(
      { ok: false, error: capaRes.error.message },
      { status: 500 },
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
      pnu,
      bjd_code: bjdCode,
      jibun,
      rows,
      total: rows.length,
      meta,
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
