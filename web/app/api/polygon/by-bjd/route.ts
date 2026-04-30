/**
 * GET /api/polygon/by-bjd?bjd_code=...
 *
 * Atomic endpoint — 행정구역(리/읍면동) 폴리곤 + 중심좌표.
 * VWorld lt_c_adri / lt_c_ademd WFS.
 *
 * 사용처:
 *   - 지도 마커 클릭 — 마을 경계 시각화
 *
 * 응답:
 *   - 매칭 성공: { ok: true, bjd_code, level, full_nm, polygon, center }
 *   - 매칭 실패: { ok: true, bjd_code, level: null, full_nm: null, polygon: null, center: null }
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAdminPolygonByBjd } from "@/lib/vworld/admin-polygon";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

// VWorld 는 한국 외 IP 차단. Vercel 기본 region(iad1) → fetch failed 발생.
export const preferredRegion = "icn1";

export const meta: EndpointMeta = {
  source:
    "VWorld lt_c_adri (리, bjd_code 끝2자리 != '00') / lt_c_ademd (읍면동, 끝2자리 == '00') WFS",
  cache: "public, s-maxage=604800, stale-while-revalidate=86400",
  auth: "user",
  inputs: [
    {
      name: "bjd_code",
      type: "string",
      required: true,
      sample: "4673025025",
      description: "행안부 법정동 코드 10자리. 끝2자리로 리/읍면동 자동 분기",
    },
  ],
  outputSchema:
    "{ ok, bjd_code, level: 'ri'|'emd'|null, full_nm: string|null, polygon: number[][][]|null, center: {lat,lng}|null }",
  externalDeps: ["vworld"],
  notes:
    "행정구역 폴리곤은 변경 거의 없음 → 1주 CDN 캐시 + stale-while-revalidate. 마을 마커 클릭 시 음영 시각화용.",
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

  const result = await getAdminPolygonByBjd(bjdCode);
  if (!result) {
    return NextResponse.json(
      {
        ok: true,
        bjd_code: bjdCode,
        level: null,
        full_nm: null,
        polygon: null,
        center: null,
      },
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  }
  return NextResponse.json(
    { ok: true, ...result },
    {
      headers: {
        "Cache-Control":
          "public, s-maxage=604800, stale-while-revalidate=86400",
      },
    }
  );
}
