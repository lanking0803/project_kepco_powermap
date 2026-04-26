/**
 * POST /api/capa/lookup
 *
 * 한글주소(addr) 또는 bjd_code + 지번(jibun) 으로 KEPCO 용량 조회.
 *
 * 흐름 (lookup-capacity 위임):
 *   - refresh=false: kepco_capa DB hit → 즉시 반환
 *   - DB miss / refresh=true: KEPCO live 호출 → upsert → 반환
 *   - 매칭 실패: source='not_found' (rows 빈 배열)
 *
 * Body:
 *   {
 *     addr?: string,                  // "경기도 양평군 청운면 갈운리 24-1"
 *     bjd_code?: string,              // 또는 bjd_code 직접 (refresh 용)
 *     jibun: string,                  // "24-1", "산1-10"
 *     refresh?: boolean,              // true: 항상 KEPCO 호출 (기본 false)
 *     includeSplitDong?: boolean,     // 동분할 후보 추가 (기본 false)
 *   }
 *
 * Response:
 *   { ok: true, source, bjd_code, addr_jibun, rows, fetched_at, candidate_used? }
 *   { ok: false, error }
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { lookupCapacity } from "@/lib/kepco-live/lookup-capacity";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "DB → KEPCO live (lookup-capacity 위임, DB miss 시 fallback)",
  cache: "no-store",
  auth: "user",
  inputs: [
    {
      name: "addr",
      type: "string",
      required: false,
      sample: "경기도 양평군 청운면 갈운리 24-1",
      description: "한글주소 (또는 bjd_code 둘 중 하나 필수)",
    },
    {
      name: "bjd_code",
      type: "string",
      required: false,
      sample: "4673025025",
      description: "행안부 법정동 코드 (refresh 용)",
    },
    {
      name: "jibun",
      type: "string",
      required: true,
      sample: "24-1",
      description: "지번 번호 (예: 24-1, 산1-10)",
    },
    {
      name: "refresh",
      type: "boolean",
      required: false,
      sample: "false",
      description: "true 시 항상 KEPCO live 호출",
    },
    {
      name: "includeSplitDong",
      type: "boolean",
      required: false,
      sample: "false",
      description: "동분할 후보 추가",
    },
  ],
  outputSchema:
    "{ ok, source: 'db'|'live'|'not_found', bjd_code: string|null, addr_jibun, rows: KepcoDataRow[], fetched_at, candidate_used? }",
  externalDeps: ["supabase", "kepco"],
  notes:
    "DB hit 시 외부 호출 0. DB miss / refresh=true 시 KEPCO live 1회 + DB upsert. POST + JSON body — 라이브 테스트 시 querystring 아닌 body 로 입력.",
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

  const b = body as {
    addr?: string;
    bjd_code?: string;
    jibun?: string;
    refresh?: boolean;
    includeSplitDong?: boolean;
  };

  if (!b.jibun) {
    return NextResponse.json(
      { ok: false, error: "jibun 필수." },
      { status: 400 },
    );
  }
  if (!b.addr && !b.bjd_code) {
    return NextResponse.json(
      { ok: false, error: "addr 또는 bjd_code 둘 중 하나 필수." },
      { status: 400 },
    );
  }

  try {
    const result = await lookupCapacity({
      addr: b.addr,
      bjd_code: b.bjd_code,
      jibun: b.jibun,
      refresh: b.refresh,
      includeSplitDong: b.includeSplitDong,
    });
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[capa/lookup] failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
