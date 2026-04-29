/**
 * GET /api/onbid/search
 *
 * Atomic endpoint — 캠코 온비드 부동산 매물 목록 조회 + enrich.
 *
 * 흐름:
 *   1. 쿼리 파라미터 → 캠코 OnbidListRawParams 매핑
 *   2. fetchOnbidListPage 호출 (필요 시 다중 페이지)
 *   3. enrichRawItems → OnbidListItem (lat/lng, ourCategory, daysLeft 등 보강)
 *   4. ourCategory 사후 필터 (캠코 단일 sclsId 한계 우회)
 *
 * 응답:
 *   { ok: true, items: OnbidListItem[], totalCount: number, fetchedAt: string }
 *
 * 사용처:
 *   - OnbidSearchPanel 검색 버튼 → 결과 카드 + 지도 마커 표시
 *
 * 캐시:
 *   - 검색 결과는 TTL 짧음 (5분 정도)
 *   - 우선은 no-store (Phase 1 완료 후 KV 캐시 추가 검토)
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  fetchOnbidListPage,
  type OnbidListRawParams,
} from "@/lib/onbid/client";
import { enrichRawItems } from "@/lib/onbid/enrich";
import { ourCategoryToSclsParam } from "@/lib/onbid/categories";
import type { OurCategory } from "@/lib/onbid/types";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "캠코 OnbidRlstListSrvc2/getRlstCltrList2 + bjd_master JOIN",
  cache: "no-store",
  auth: "user",
  inputs: [
    { name: "sido", type: "string", required: false, sample: "전라남도", description: "시도" },
    { name: "sigungu", type: "string", required: false, sample: "나주시", description: "시군구" },
    { name: "emdong", type: "string", required: false, sample: "", description: "읍면동" },
    {
      name: "categories",
      type: "string",
      required: false,
      sample: "",
      description: "OurCategory 다중 선택 (콤마 구분, 예: 토지,창고)",
    },
    { name: "landMin", type: "number", required: false, sample: "" },
    { name: "landMax", type: "number", required: false, sample: "" },
    { name: "apslMin", type: "number", required: false, sample: "" },
    { name: "apslMax", type: "number", required: false, sample: "" },
    { name: "bidStart", type: "string", required: false, sample: "", description: "YYYY-MM-DD" },
    { name: "bidEnd", type: "string", required: false, sample: "", description: "YYYY-MM-DD" },
    { name: "usbdMin", type: "number", required: false, sample: "" },
    { name: "usbdMax", type: "number", required: false, sample: "" },
    { name: "pageNo", type: "number", required: false, sample: "1" },
    { name: "numOfRows", type: "number", required: false, sample: "20" },
  ],
  outputSchema:
    "{ ok: true, items: OnbidListItem[], totalCount: number, fetchedAt: string }",
  externalDeps: ["data.go.kr (캠코 OnbidRlstListSrvc2)", "supabase (bjd_master)"],
  notes:
    "다중 카테고리는 캠코가 단일 코드만 받아 응답 후 클라이언트 사이드 필터로 처리. " +
    "토지/건물50plus 는 응답 sclsId/bldSqms 로 분류. " +
    "응답에 lat/lng 누락된 매물(bjd_master 미수록)은 클라이언트 마커 표시에서 자동 제외.",
};

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 },
    );
  }

  const sp = req.nextUrl.searchParams;
  const categoriesRaw = sp.get("categories") ?? "";
  const categories = categoriesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as OurCategory[];

  const pageNo = Math.max(1, parseInt(sp.get("pageNo") ?? "1", 10));
  // 1,000 건 한도 — 클라이언트 사이드 렌더 부담 + 한 번 호출로 충분.
  const numOfRows = Math.min(
    1000,
    Math.max(1, parseInt(sp.get("numOfRows") ?? "1000", 10)),
  );

  // 카테고리가 단일이고 단일 코드 매핑 가능하면 캠코 sclsId 필터 사용 (효율적)
  // 그 외 (다중 카테고리 또는 사후 필터 필요) → 캠코 대분류만, 응답 후 필터
  let sclsParam: string | undefined;
  let postFilterCategories: OurCategory[] | null = null;
  if (categories.length === 1) {
    const single = ourCategoryToSclsParam(categories[0]);
    if (single) {
      sclsParam = single;
      // 12100 (유리온실/축사) 의 경우 sclsId 로는 둘 다 잡히므로 매물명 키워드 후필터 필요
      if (single === "12100") postFilterCategories = categories;
    } else {
      postFilterCategories = categories;
    }
  } else if (categories.length > 1) {
    postFilterCategories = categories;
  }

  const rawParams: OnbidListRawParams = {
    pageNo,
    numOfRows,
    prptDivCd: "0007",
    pvctTrgtYn: "N",
    cltrUsgLclsCtgrId: "10000", // 부동산
    cltrUsgSclsCtgrId: sclsParam,
    lctnSdnm: sp.get("sido") ?? undefined,
    lctnSggnm: sp.get("sigungu") ?? undefined,
    lctnEmdNm: sp.get("emdong") ?? undefined,
    landSqmsStart: numOrUndef(sp.get("landMin")),
    landSqmsEnd: numOrUndef(sp.get("landMax")),
    apslEvlAmtStart: numOrUndef(sp.get("apslMin")),
    apslEvlAmtEnd: numOrUndef(sp.get("apslMax")),
    bidPrdYmdStart: ymdOrUndef(sp.get("bidStart")),
    bidPrdYmdEnd: ymdOrUndef(sp.get("bidEnd")),
    usbdNftStart: numOrUndef(sp.get("usbdMin")),
    usbdNftEnd: numOrUndef(sp.get("usbdMax")),
  };

  try {
    const raw = await fetchOnbidListPage(rawParams);
    let items = await enrichRawItems(raw.items);

    // 카테고리 사후 필터
    if (postFilterCategories && postFilterCategories.length > 0) {
      const allow = new Set(postFilterCategories);
      items = items.filter((it) => it.ourCategory && allow.has(it.ourCategory));
    }

    return NextResponse.json(
      {
        ok: true,
        items,
        totalCount: raw.totalCount,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[onbid/search] error", e);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 },
    );
  }
}

function numOrUndef(v: string | null): number | undefined {
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** "2026-04-30" → "20260430" */
function ymdOrUndef(v: string | null): string | undefined {
  if (!v) return undefined;
  const digits = v.replace(/[^\d]/g, "");
  if (digits.length !== 8) return undefined;
  return digits;
}
