/**
 * POST /api/capa/refresh-by-pnu
 *
 * Body: { pnu: string }
 *
 * PNU 단위 KEPCO 용량 강제 갱신 — KEPCO live 호출 + kepco_capa upsert.
 *
 * 흐름 (lookup-capacity 위임, refresh=true 고정):
 *   - 항상 KEPCO live 호출 (DB hit 무시)
 *   - 응답을 kepco_capa upsert
 *   - 매칭 실패: source='not_found' (rows 빈 배열)
 *
 * 사용처:
 *   - ParcelInfoPanel [전기] 탭의 "KEPCO 에서 지금 확인" / 새로고침 버튼.
 *
 * 단순 DB 재조회는 별도 endpoint:
 *   - GET /api/capa/by-pnu  (캐시 비우고 재호출)
 *
 * 응답:
 *   { ok: true, source, bjd_code, addr_jibun, rows, fetched_at, candidate_used? }
 *   { ok: false, error }
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { lookupCapacity } from "@/lib/kepco-live/lookup-capacity";
import { jibunFromPnu } from "@/lib/geo/pnu";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "KEPCO live (lookup-capacity, refresh=true 고정) + kepco_capa upsert",
  cache: "no-store",
  auth: "user",
  inputs: [
    {
      name: "pnu",
      type: "string",
      required: true,
      sample: "4673025025104230011",
      description:
        "PNU 19자리 (bjd_code 10 + 산구분 1 + 본번 4 + 부번 4). 행안부 표준 (1=일반/2=산).",
    },
  ],
  outputSchema:
    "{ ok, source: 'live'|'not_found', bjd_code, addr_jibun, rows: KepcoDataRow[], fetched_at, candidate_used? }",
  externalDeps: ["kepco", "supabase"],
  notes:
    "항상 KEPCO live 1회 호출 + DB upsert (refresh=true 고정). DB-only 조회는 GET /api/capa/by-pnu 사용. PNU → bjd_code/jibun 분리는 lib/geo/pnu (jibunFromPnu).",
};

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "JSON body 가 필요합니다." },
      { status: 400 },
    );
  }

  const pnu = (body as { pnu?: string })?.pnu?.trim() ?? "";
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

  try {
    const result = await lookupCapacity({
      bjd_code: bjdCode,
      jibun,
      refresh: true,
    });
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[capa/refresh-by-pnu] failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
