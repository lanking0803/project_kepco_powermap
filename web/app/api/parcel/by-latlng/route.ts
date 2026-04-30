/**
 * GET /api/parcel/by-latlng?lat=...&lng=...
 *
 * Atomic endpoint — 좌표 → 필지 폴리곤 + PNU + 주소/지목/면적/공시지가.
 * VWorld WFS BBOX (±5m) → point-in-polygon 으로 정확 필지 선별.
 *
 * 사용처:
 *   - 지도 직접 클릭 — PNU 미확보 상태에서 필지 정보 조회
 *
 * 응답:
 *   - 필지 매칭 성공: { ok: true, lat, lng, jibun, geometry }
 *   - 매칭 실패 (바다 / 미등록): { ok: true, lat, lng, jibun: null, geometry: null }
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getParcelByPoint } from "@/lib/vworld/parcel";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

// VWorld 는 한국 외 IP 차단. Vercel 기본 region(iad1) → fetch failed 발생.
export const preferredRegion = "icn1";

export const meta: EndpointMeta = {
  source: "VWorld WFS BBOX (±5m) + point-in-polygon 선별",
  cache: "private, s-maxage=86400, max-age=3600",
  auth: "user",
  inputs: [
    {
      name: "lat",
      type: "number",
      required: true,
      sample: "37.4946",
      description: "위도 (소수점 4~6자리)",
    },
    {
      name: "lng",
      type: "number",
      required: true,
      sample: "127.0276",
      description: "경도",
    },
  ],
  outputSchema:
    "{ ok, lat, lng, jibun: JibunInfo | null, geometry: ParcelGeometry | null } — 매칭 실패 시 jibun/geometry null",
  externalDeps: ["vworld"],
  notes:
    "지도 직접 클릭 (PNU 미확보 상태) 진입점. 응답 형식은 by-pnu 와 동일 (pnu 대신 lat/lng 에코). 바다·미등록은 max-age=300.",
};

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  const lat = parseFloat(request.nextUrl.searchParams.get("lat") || "");
  const lng = parseFloat(request.nextUrl.searchParams.get("lng") || "");
  if (!isFinite(lat) || !isFinite(lng)) {
    return NextResponse.json(
      { ok: false, error: "lat/lng 값이 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const result = await getParcelByPoint(lat, lng);
  if (!result) {
    return NextResponse.json(
      { ok: true, lat, lng, jibun: null, geometry: null },
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  }
  return NextResponse.json(
    { ok: true, lat, lng, jibun: result.jibun, geometry: result.geometry },
    {
      headers: { "Cache-Control": "private, s-maxage=86400, max-age=3600" },
    }
  );
}
