/**
 * GET /api/solar-permits/by-pnu?pnu=...
 *
 * 매물 PNU 19자리 → 같은 필지 + 같은 동/리 태양광 발전소 현황.
 *
 * 응답 (성공):
 *   {
 *     ok: true,
 *     pnu, bjd_code,
 *     same_pnu: [{ facility_name, capacity_kw, operating_status, permit_date, lat, lng }],
 *     same_dong: { count, total_kw }
 *   }
 *
 * 데이터 출처: solar_permits 테이블 (매월 1일 09:00 KST GH Actions cron 으로 적재)
 * 외부 API 호출 없음. 우리 DB 단일 조회 1회 (Promise.all 로 2쿼리 동시).
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "DB (solar_permits) — data.go.kr NIA 15107742 가 출처, 매월 1일 GH cron 적재",
  cache: "private, s-maxage=600, max-age=120",
  auth: "user",
  inputs: [
    {
      name: "pnu",
      type: "string",
      required: true,
      sample: "4684039022012340005",
      description: "매물 PNU 19자리 숫자 (시도2+시군구3+읍면동3+산구분1+본번4+부번4)",
    },
  ],
  outputSchema:
    "{ ok, pnu, bjd_code, same_pnu: SolarPermitRow[], same_dong: { count, total_kw } }",
  externalDeps: [],
  notes:
    "매월 갱신되는 정적 스냅샷이라 캐시 길게(10분) 가능. same_pnu = 같은 필지 정확 매칭, same_dong = 같은 법정동(리) 단위 집계 (영업 멘트용).",
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

  // 동시 2쿼리 — 같은 필지 + 같은 동/리 집계
  const [samePnuRes, sameDongRes] = await Promise.all([
    supabase
      .from("solar_permits")
      .select(
        "facility_name, capacity_kw, operating_status, permit_date, lat, lng",
      )
      .eq("pnu", pnu)
      .order("capacity_kw", { ascending: false })
      .limit(50),
    supabase
      .from("solar_permits")
      .select("capacity_kw")
      .eq("bjd_code", bjd_code)
      .limit(1000),
  ]);

  if (samePnuRes.error) {
    return NextResponse.json(
      { ok: false, error: samePnuRes.error.message },
      { status: 502 },
    );
  }
  if (sameDongRes.error) {
    return NextResponse.json(
      { ok: false, error: sameDongRes.error.message },
      { status: 502 },
    );
  }

  const sameDongRows = sameDongRes.data ?? [];
  const sameDongTotal = sameDongRows.reduce(
    (s, r) => s + (Number(r.capacity_kw) || 0),
    0,
  );

  return NextResponse.json(
    {
      ok: true,
      pnu,
      bjd_code,
      same_pnu: samePnuRes.data ?? [],
      same_dong: {
        count: sameDongRows.length,
        total_kw: Math.round(sameDongTotal),
      },
    },
    {
      headers: { "Cache-Control": "private, s-maxage=600, max-age=120" },
    },
  );
}
