/**
 * GET /api/parcel/by-pnu?pnu=...
 *
 * Atomic endpoint — PNU 19자리 → 필지 폴리곤 + 주소/지목/면적/공시지가.
 * VWorld WFS 직접 조회 (fes:Filter, 1:1 매칭, 실측 ~40ms).
 *
 * 사용처:
 *   - 지번 클릭 (사이드바) — bjd_code + jibun 으로 PNU 조립 후 호출
 *   - 지도 클릭 — /api/parcel/by-latlng 응답 PNU 로 폴리곤 재호출 (또는 캐시 활용)
 *
 * 응답 (성공):
 *   { ok: true, pnu, jibun, geometry }
 * 응답 (필지 없음):
 *   { ok: true, pnu, jibun: null, geometry: null }
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getParcelByPnu } from "@/lib/vworld/parcel";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

// VWorld 는 한국 외 IP 차단. Vercel 기본 region(iad1) → fetch failed 발생.
export const preferredRegion = "icn1";

export const meta: EndpointMeta = {
  source: "VWorld WFS (fes:Filter PropertyIsEqualTo, 1:1 매칭, 실측 ~40ms)",
  cache: "private, s-maxage=86400, max-age=3600",
  auth: "user",
  inputs: [
    {
      name: "pnu",
      type: "string",
      required: true,
      sample: "4683034023000070000",
      description: "PNU 19자리 숫자 (시도2+시군구3+읍면동3+산구분1+본번4+부번4+필지타입2)",
    },
  ],
  outputSchema:
    "{ ok, pnu, jibun: JibunInfo | null, geometry: ParcelGeometry | null }",
  externalDeps: ["vworld"],
  notes:
    "필지 매칭 실패 시 jibun/geometry 모두 null + max-age=300 (5분 짧은 캐시). 가격 탭 공시지가 등 7~8가지 정보 atomic 1회. CDN 1d / 브라우저 1h.",
};

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  const pnu = request.nextUrl.searchParams.get("pnu")?.trim() ?? "";
  if (!/^\d{19}$/.test(pnu)) {
    return NextResponse.json(
      { ok: false, error: "pnu 는 19자리 숫자여야 합니다." },
      { status: 400 }
    );
  }

  const result = await getParcelByPnu(pnu);
  if (!result) {
    return NextResponse.json(
      { ok: true, pnu, jibun: null, geometry: null },
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  }

  return NextResponse.json(
    { ok: true, pnu, jibun: result.jibun, geometry: result.geometry },
    {
      headers: { "Cache-Control": "private, s-maxage=86400, max-age=3600" },
    }
  );
}
