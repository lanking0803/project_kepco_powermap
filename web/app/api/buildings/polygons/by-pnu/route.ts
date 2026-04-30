/**
 * GET /api/buildings/polygons/by-pnu?pnu=...
 *
 * Atomic endpoint — PNU 19자리 → 그 필지 위 건물 N동 폴리곤.
 * 견적 모드(/quote/[pnu])의 옥상 면적 산출 + 동별 패널 시각화 입력.
 *
 * 사용처:
 *   - QuoteMode 진입 시 자동 호출 → 카카오맵에 건물 폴리곤 그리기
 *   - 향후 3차 단계 패널 그리드 시각화의 동별 분할 기준
 *
 * 응답:
 *   { ok: true, pnu, rows: BuildingPolygon[] }   // 0건도 정상 (가설건축물/빈땅)
 *   { ok: false, error }
 *
 * 캐시: private, s-maxage=86400 (건물 신축/철거는 거의 없음, 건축물대장 표제부와 동일 정책)
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getBuildingsByPnuWithDebug } from "@/lib/vworld/buildings";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

// VWorld 는 한국 외 IP 차단. Vercel 기본 region(iad1) → fetch failed 발생.
export const preferredRegion = "icn1";

export const meta: EndpointMeta = {
  source: "VWorld WFS lt_c_spbd (도로명주소건물, fes:Filter pnu 1:1 매칭)",
  cache: "private, s-maxage=86400, max-age=3600",
  auth: "user",
  inputs: [
    {
      name: "pnu",
      type: "string",
      required: true,
      sample: "4783035035101790000",
      description: "PNU 19자리 — 필지 단위 1:1 매칭",
    },
  ],
  outputSchema:
    "{ ok, pnu, rows: BuildingPolygon[] }   // 0건도 정상 (비닐하우스/간이축사 가설건축물 미등록)",
  externalDeps: ["vworld"],
  notes:
    "한 필지 여러 동 → rows 배열. 옥상 합산 면적 = sum(rows.area_m2). bd_mgt_sn 으로 건축물대장 표제부와 join 가능. 검증 (직리 179: 11동, 서울시청 BBOX: 33동).",
};

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 },
    );
  }

  const pnu = request.nextUrl.searchParams.get("pnu")?.trim() ?? "";
  if (!/^\d{19}$/.test(pnu)) {
    return NextResponse.json(
      { ok: false, error: "pnu 는 19자리 숫자여야 합니다." },
      { status: 400 },
    );
  }

  try {
    const { rows, debug } = await getBuildingsByPnuWithDebug(pnu);
    // dev 환경에서만 _debug 노출 (의뢰자 진단용 임시)
    const _debug = process.env.NODE_ENV === "development" ? debug : undefined;
    return NextResponse.json(
      { ok: true, pnu, rows, _debug },
      {
        // 0건 결과는 캐시 짧게 (디버그 중 빠른 재호출 위해)
        headers: {
          "Cache-Control":
            rows.length > 0
              ? "private, s-maxage=86400, max-age=3600"
              : "private, max-age=0",
        },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[buildings/polygons/by-pnu] failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
