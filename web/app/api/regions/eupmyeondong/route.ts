/**
 * GET /api/regions/eupmyeondong?sigungu_code=11680
 *
 * Atomic endpoint — 한 시군구 안의 읍·면·동 + 자식 리(있으면).
 *
 * 외부 건축HUB API 의 단위 (실측 2026-05-03):
 *   - 도시 동 (sep_5 NULL)        → sep_4 코드로 응답  ✅
 *   - 농촌 읍/면 (sep_5 NULL)     → 0건 (외부 API 미지원) ❌
 *   - 농촌 리 (sep_5 NOT NULL)    → sep_5 코드로 응답  ✅
 *
 * 따라서 응답 1번에 부모(동/면) + 자식(리) 모두 포함:
 *   - 도시: hasChildren=false, children=[] → 동 코드로 외부 API 호출
 *   - 농촌: hasChildren=true,  children=[리…] → 리 코드들로 외부 API 호출
 *
 * 캐시:
 *   - 30일 CDN (s-maxage=2592000) + SWR 1일.
 *   - 클라이언트는 lib/api/regions.ts 가 시군구별 모듈 캐시로 한 번 더 합침.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listEupmyeondongs } from "@/lib/regions/eupmyeondong";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "Supabase bjd_master (행안부 법정동 코드, 월 1회 갱신).",
  cache: "public, s-maxage=2592000, stale-while-revalidate=86400",
  auth: "user",
  inputs: [
    {
      name: "sigungu_code",
      type: "string",
      required: true,
      sample: "11680",
      description:
        "시군구 5자리 (bjd_code 앞 5자리). /api/regions/sigungu 의 code 와 동일.",
    },
  ],
  outputSchema:
    "{ ok, sigungu_code, count, items: Array<{ code, label, sido, si, gu, hasChildren, children: Array<{ code, label }> }> }",
  externalDeps: [],
  notes: "시군구 안의 동/면 + 그 아래 리까지 1번 호출에 모두 포함. 도시 동 = hasChildren:false, 농촌 면 = hasChildren:true + children(리들). 외부 건축HUB API 가 도시는 동 코드, 농촌은 리 코드로만 응답하기 때문(2026-05-03 실측). 30일 CDN + 클라이언트 모듈 캐시.",
};

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 },
    );
  }

  const sigunguCode = (
    request.nextUrl.searchParams.get("sigungu_code") || ""
  ).trim();
  if (!/^\d{5}$/.test(sigunguCode)) {
    return NextResponse.json(
      { ok: false, error: "sigungu_code 는 5자리 숫자여야 합니다." },
      { status: 400 },
    );
  }

  const items = await listEupmyeondongs(sigunguCode);
  return NextResponse.json(
    { ok: true, sigungu_code: sigunguCode, count: items.length, items },
    {
      headers: {
        "Cache-Control":
          "public, s-maxage=2592000, stale-while-revalidate=86400",
      },
    },
  );
}
