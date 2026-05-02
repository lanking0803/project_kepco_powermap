/**
 * GET /api/uq-villages/by-bjd?bjd_code=...
 *
 * Atomic endpoint — 자연취락지구 폴리곤 (시군구 단위 응답).
 * VWorld lt_c_uq128 WFS.
 *
 * ⚠️ 응답은 시군구 통째 (앞 5자리 단위) — 호출 측이 클릭한 마을 폴리곤과
 * 교차 비교(Turf.booleanIntersects)해서 추려야 함. VWorld 데이터 자체에
 * 읍면동/리 단위 코드가 없어 API 차원에서 더 좁힐 방법이 없음.
 *
 * 사용처:
 *   - 마을(리/읍면동) 마커 클릭 — 마을 안에 있는 자연취락지구 영역 시각화
 *
 * 응답:
 *   - { ok: true, bjd_code, sgg_code, count, villages: UqVillage[] }
 *   - 0건: villages: []
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getUqVillagesByBjd } from "@/lib/vworld/uq-villages";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source:
    "VWorld lt_c_uq128 WFS (용도지구 — 자연취락지구). std_sggcd 5자리 단위 필터.",
  cache: "public, s-maxage=604800, stale-while-revalidate=86400",
  auth: "user",
  inputs: [
    {
      name: "bjd_code",
      type: "string",
      required: true,
      sample: "4157035025",
      description:
        "행안부 법정동 코드 10자리. 내부에서 앞 5자리(std_sggcd)로 시군구 단위 호출.",
    },
  ],
  outputSchema:
    "{ ok, bjd_code, sgg_code, count, villages: Array<{ mnum, uname, sido_name, sigg_name, polygon: number[][][], center: {lat,lng}, area_m2 }> }",
  externalDeps: ["vworld"],
  notes:
    "VWorld lt_c_uq128 은 OGC FILTER (XML) 만 작동 — CQL_FILTER/attrFilter 무시 함정 (검증 2026-05-02). 응답이 시군구 통째라 호출 측에서 마을 폴리곤과 Turf.booleanIntersects 후처리 필수. 분기 1회 갱신 데이터 → 1주 CDN 캐시.",
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

  const villages = await getUqVillagesByBjd(bjdCode);
  return NextResponse.json(
    {
      ok: true,
      bjd_code: bjdCode,
      sgg_code: bjdCode.slice(0, 5),
      count: villages.length,
      villages,
    },
    {
      headers: {
        "Cache-Control":
          "public, s-maxage=604800, stale-while-revalidate=86400",
      },
    }
  );
}
