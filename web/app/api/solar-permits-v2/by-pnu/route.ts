/**
 * GET /api/solar-permits-v2/by-pnu?pnu=...
 *
 * v1 과 동일한 응답을 주는 시범 라우트 — DB 대신 Supabase Storage 에서 받음.
 *
 * 흐름:
 *   1. PNU 검증 + bjd_code 추출
 *   2. Storage 'solar-permits' bucket 에서 ${bjd_code}.json 다운로드
 *   3. JS 측 filter/reduce 로 same_pnu / same_dong 계산 (v1 SQL 결과와 동일하게)
 *   4. v1 과 같은 JSON 응답
 *
 * 비교 검증 후 v1 교체 예정. 검증 끝나면 이 라우트 삭제.
 *
 * 응답 형식 = v1 과 동일:
 *   { ok, pnu, bjd_code, same_pnu: SolarPermitRow[], same_dong: { count, total_kw } }
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

const BUCKET = "solar-permits";
const SAME_PNU_LIMIT = 50;

interface SolarRow {
  pnu: string;
  facility_name: string;
  capacity_kw: number | null;
  operating_status: string | null;
  permit_date: string | null;
  lat: number | null;
  lng: number | null;
}

export const meta: EndpointMeta = {
  source:
    "Storage (solar-permits bucket) — 시범 v2. 파일별 BJD JSON 다운로드 후 JS 측 필터링.",
  cache: "private, s-maxage=600, max-age=120",
  auth: "user",
  inputs: [
    {
      name: "pnu",
      type: "string",
      required: true,
      sample: "4684039022012340005",
      description: "매물 PNU 19자리 숫자",
    },
  ],
  outputSchema:
    "{ ok, pnu, bjd_code, same_pnu: SolarPermitRow[], same_dong: { count, total_kw } } — v1 과 동일",
  externalDeps: [],
  notes:
    "v1 (DB) 와 응답 동일성 검증용 시범 라우트. BJD JSON 파일이 없으면 빈 응답 (해당 동에 발전소 없음).",
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
      { ok: false, error: "pnu 는 19자리 숫자여야 합니다." },
      { status: 400 },
    );
  }
  const bjd_code = pnu.slice(0, 10);

  const supabase = createAdminClient();

  // BJD JSON 다운로드 — 없으면 그 동에 발전소 0건이라는 의미 (정상 케이스)
  const { data: blob, error: dlErr } = await supabase.storage
    .from(BUCKET)
    .download(`${bjd_code}.json`);

  if (dlErr) {
    // "Object not found" = 그 BJD 에 발전소 없음 (정상)
    const isNotFound =
      dlErr.message?.toLowerCase().includes("not found") ||
      dlErr.message?.toLowerCase().includes("not_found");
    if (isNotFound) {
      return emptyResponse(pnu, bjd_code);
    }
    return NextResponse.json(
      { ok: false, error: `Storage 다운로드 실패: ${dlErr.message}` },
      { status: 502 },
    );
  }

  let rows: SolarRow[];
  try {
    const text = await blob.text();
    rows = JSON.parse(text) as SolarRow[];
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `JSON 파싱 실패: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  // same_pnu — 정확히 일치하는 PNU 만, capacity_kw 내림차순, 50건 제한 (v1 과 동일)
  const samePnu = rows
    .filter((r) => r.pnu === pnu)
    .sort((a, b) => (b.capacity_kw ?? 0) - (a.capacity_kw ?? 0))
    .slice(0, SAME_PNU_LIMIT)
    .map((r) => ({
      facility_name: r.facility_name,
      capacity_kw: r.capacity_kw,
      operating_status: r.operating_status,
      permit_date: r.permit_date,
      lat: r.lat,
      lng: r.lng,
    }));

  // same_dong — 그 BJD 전체 (rows 자체) 합산
  const sameDongCount = rows.length;
  const sameDongTotal = rows.reduce(
    (s, r) => s + (Number(r.capacity_kw) || 0),
    0,
  );

  return NextResponse.json(
    {
      ok: true,
      pnu,
      bjd_code,
      same_pnu: samePnu,
      same_dong: {
        count: sameDongCount,
        total_kw: Math.round(sameDongTotal),
      },
    },
    {
      headers: { "Cache-Control": "private, s-maxage=600, max-age=120" },
    },
  );
}

function emptyResponse(pnu: string, bjd_code: string) {
  return NextResponse.json(
    {
      ok: true,
      pnu,
      bjd_code,
      same_pnu: [],
      same_dong: { count: 0, total_kw: 0 },
    },
    {
      headers: { "Cache-Control": "private, s-maxage=600, max-age=120" },
    },
  );
}
