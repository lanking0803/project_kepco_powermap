/**
 * GET /api/buildings/by-pnu?pnu=...
 *
 * Atomic endpoint — PNU 19자리 → 건축물대장 표제부 (메인 건물 정보).
 * 영업 결정 1차 필터 (공장/창고 vs 주택), 옥상 태양광 잠재력 추정용.
 *
 * 사용처:
 *   - ParcelInfoPanel "필지" 탭 클릭 시 lazy fetch
 *
 * 응답:
 *   { ok: true, pnu, rows: BuildingTitleInfo[] }   // 0건도 정상 (빈 땅/미등록)
 *   { ok: false, error }
 *
 * 캐시: private, s-maxage=86400 (건축물대장은 신축/철거 외엔 거의 안 변함)
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getBuildingTitleByPnu } from "@/lib/building-hub/title";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "건축HUB getBrTitleInfo (국토부 BldRgstHubService) — 표제부 단건",
  cache: "private, s-maxage=86400, max-age=3600",
  auth: "user",
  inputs: [
    {
      name: "pnu",
      type: "string",
      required: true,
      sample: "1168010300100590000",
      description: "PNU 19자리. 11번째 자리(산구분)가 platGbCd 로 자동 변환",
    },
  ],
  outputSchema:
    "{ ok, pnu, rows: BuildingTitleInfo[] }   // 0건도 정상 (빈 땅/미등록)",
  externalDeps: ["bldg-register"],
  notes:
    "한 지번 여러 동 → rows 배열. 표제부 응답 78필드 → 영업가치 22개만 발췌 정규화. 비닐하우스/간이 슬레이트 축사는 가설건축물이라 거의 미등록.",
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
    const rows = await getBuildingTitleByPnu(pnu);
    return NextResponse.json(
      { ok: true, pnu, rows },
      {
        headers: { "Cache-Control": "private, s-maxage=86400, max-age=3600" },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[buildings/by-pnu] failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
