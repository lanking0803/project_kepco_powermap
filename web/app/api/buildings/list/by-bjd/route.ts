/**
 * GET /api/buildings/list/by-bjd?bjd_code=...&page_no=1&num_of_rows=500
 *
 * Atomic endpoint — 법정동 1개 안의 건축물대장 표제부 일괄 조회 (1페이지).
 *
 * 사용처:
 *   - 시설 모드 검색: 시도 → 시군구 → 동 선택 후 그 동 안 모든 건물 일괄 조회
 *   - 적재 스크립트: 페이지 자동 순회로 영업 권역 사전 적재
 *
 * 응답:
 *   { ok: true, bjd_code, page_no, num_of_rows, total_count, has_more, rows: BuildingTitleInfo[] }
 *   { ok: false, error }
 *
 * 캐시:
 *   - public, s-maxage=86400 (1일) + SWR 7일
 *   - 건축물대장은 신축/철거 외 거의 안 변함 — 1일 fresh 충분
 *   - 외부 API 한도(10,000/일) 보호 효과
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listBuildingsByBjd } from "@/lib/building-hub/list";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "건축HUB getBrTitleInfo (국토부 BldRgstHubService) — 법정동 단위 일괄",
  cache: "public, s-maxage=86400, stale-while-revalidate=604800",
  auth: "user",
  inputs: [
    {
      name: "bjd_code",
      type: "string",
      required: true,
      sample: "1168010100",
      description: "법정동 10자리 (시군구5+동5). /api/regions/eupmyeondong 의 code.",
    },
    {
      name: "page_no",
      type: "number",
      required: false,
      sample: "1",
      description: "페이지 번호 (1-base, 기본 1)",
    },
    {
      name: "num_of_rows",
      type: "number",
      required: false,
      sample: "100",
      description: "페이지당 행수 (기본 100). 외부 API 가 100 hard cap — 큰 값 보내도 100 만 응답.",
    },
  ],
  outputSchema: "{ ok, bjd_code, page_no, num_of_rows, total_count, has_more, rows: BuildingTitleInfo[] }",
  externalDeps: ["bldg-register"],
  notes: "외부 API 가 sigunguCd+bjdongCd 둘 다 필수 — bjd_code 10자리 입력 필수. atomic endpoint 는 1페이지만 응답, 자동 순회는 호출자(적재 스크립트) 담당. 시설 모드 영업 발굴용 핵심 endpoint.",
};

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 },
    );
  }

  const sp = request.nextUrl.searchParams;
  const bjdCode = (sp.get("bjd_code") || "").trim();
  if (!/^\d{10}$/.test(bjdCode)) {
    return NextResponse.json(
      { ok: false, error: "bjd_code 는 10자리 숫자여야 합니다." },
      { status: 400 },
    );
  }

  const pageNo = parsePositiveInt(sp.get("page_no"), 1);
  // 외부 API 100 hard cap — clamp 도 100 으로 (실측 2026-05-03)
  const numOfRows = clampInt(parsePositiveInt(sp.get("num_of_rows"), 100), 1, 100);

  try {
    const result = await listBuildingsByBjd(bjdCode, { pageNo, numOfRows });
    return NextResponse.json(
      {
        ok: true,
        bjd_code: result.bjdCode,
        page_no: result.pageNo,
        num_of_rows: result.numOfRows,
        total_count: result.totalCount,
        has_more: result.hasMore,
        rows: result.rows,
      },
      {
        headers: {
          "Cache-Control":
            "public, s-maxage=86400, stale-while-revalidate=604800",
        },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[buildings/list/by-bjd] failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
