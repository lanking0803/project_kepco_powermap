/**
 * GET /api/facility/search
 *
 * Atomic endpoint — 시설 모드 검색. 건축HUB 일괄 조회 + bjd_master JOIN.
 *
 * 흐름 (공매·경매 패턴 미러):
 *   1. bjd_codes (콤마 구분 N개) + categories + min_pyeong 입력
 *   2. 각 BJD 코드 마다 자동 페이지 순회로 건축물대장 일괄 조회 (max 20p = 2,000건)
 *   3. enrichFacilities → 분류(부속건축물 제외) + 평수 계산 + bjd_master 좌표 보강
 *   4. categories 필터 + min_pyeong 필터 (서버 사후 필터)
 *
 * 응답:
 *   { ok: true, items: FacilityListItem[], totalCount: number, capped: boolean, fetchedAt: string }
 *
 * 사용처:
 *   - FacilitySearchPanel — 검색 결과 카드 + 지도 마을 마커 표시
 *
 * 캐시:
 *   - public, s-maxage=86400 (1일) — 건축물대장은 거의 안 변함
 *   - 외부 API 한도 보호
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listBuildingsByBjd } from "@/lib/building-hub/list";
import type { BuildingTitleInfo } from "@/lib/building-hub/title";
import {
  FACILITY_CATEGORY_ORDER,
  type FacilityCategory,
} from "@/lib/facility/classify";
import { enrichFacilities } from "@/lib/facility/enrich";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source:
    "건축HUB getBrTitleInfo (다중 BJD 자동 페이지 순회) + supabase bjd_master JOIN",
  cache: "public, s-maxage=86400, stale-while-revalidate=604800",
  auth: "user",
  inputs: [
    {
      name: "bjd_codes",
      type: "string",
      required: true,
      sample: "1168010500,1168010600",
      description:
        "법정동 10자리 (시군구5+동5) 콤마 구분. 단건 또는 농촌 면 아래 리 N개 일괄.",
    },
    {
      name: "categories",
      type: "string",
      required: false,
      sample: "greenhouse,barn,factory,warehouse",
      description:
        "FacilityCategory 다중 선택 (콤마 구분). 빈값=전체. 부속건축물은 자동 제외.",
    },
    {
      name: "min_pyeong",
      type: "number",
      required: false,
      sample: "0",
      description:
        "최소 평수 (이상). 0=필터 없음. archArea 미상 row 는 0보다 크면 제외.",
    },
    {
      name: "max_pages",
      type: "number",
      required: false,
      sample: "20",
      description:
        "BJD 1개당 최대 페이지 (1p=100건, hard cap). 기본 20=2,000건.",
    },
    {
      name: "concurrency",
      type: "number",
      required: false,
      sample: "5",
      description: "다중 BJD 동시 호출 한도. 기본 5.",
    },
  ],
  outputSchema:
    "{ ok: true, items: FacilityListItem[], totalCount: number, capped: boolean, fetchedAt: string }",
  externalDeps: ["bldg-register", "supabase"],
  notes:
    "시설(필지) 모드 atomic. 공매·경매 search 와 같은 패턴: 외부 단건 호출 + bjd_master JOIN 으로 좌표 보강 → 마을 마커. categories 빈값이면 부속건축물 제외 후 모든 카테고리 통과(other 포함). archArea 평 환산 = archArea ÷ 3.305785.",
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

  // bjd_codes — 필수, 콤마 구분 10자리 N개
  const bjdRaw = (sp.get("bjd_codes") ?? "").trim();
  const bjdCodes = bjdRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{10}$/.test(s));
  if (bjdCodes.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "bjd_codes 는 콤마 구분 10자리 숫자 1개 이상이어야 합니다.",
      },
      { status: 400 },
    );
  }

  // categories — 콤마 구분, 빈값=전체
  const allowedCats = new Set<FacilityCategory>(FACILITY_CATEGORY_ORDER);
  const catRaw = sp.get("categories") ?? "";
  const catSet = new Set<FacilityCategory>(
    catRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is FacilityCategory =>
        allowedCats.has(s as FacilityCategory),
      ),
  );
  const useCatFilter = catSet.size > 0;

  // min_pyeong, max_pages, concurrency
  const minPyeong = Math.max(0, numOrZero(sp.get("min_pyeong")));
  const maxPages = clampInt(numOrZero(sp.get("max_pages")) || 20, 1, 50);
  const concurrency = clampInt(numOrZero(sp.get("concurrency")) || 5, 1, 10);

  try {
    // 1) 다중 BJD 페이지 순회 — 워커풀 (공매처럼 한방 IN 대신 외부는 BJD 단건씩)
    const allRows: BuildingTitleInfo[] = [];
    let totalCountSum = 0;
    let anyCapped = false;

    let cursor = 0;
    async function worker() {
      while (true) {
        const idx = cursor++;
        if (idx >= bjdCodes.length) return;
        const bjd = bjdCodes[idx];
        const rows = await fetchAllByBjd(bjd, maxPages);
        allRows.push(...rows.rows);
        totalCountSum += rows.totalCount;
        if (rows.capped) anyCapped = true;
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, bjdCodes.length) }, worker),
    );

    // 2) 좌표 보강 + 분류
    const enriched = await enrichFacilities(allRows);

    // 3) 카테고리 + 평수 사후 필터
    const filtered = enriched.filter((it) => {
      if (useCatFilter && !catSet.has(it.category)) return false;
      if (minPyeong > 0) {
        if (it.pyeong == null) return false;
        if (it.pyeong < minPyeong) return false;
      }
      return true;
    });

    return NextResponse.json(
      {
        ok: true,
        items: filtered,
        totalCount: totalCountSum,
        capped: anyCapped,
        fetchedAt: new Date().toISOString(),
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
    console.error("[facility/search] failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** 1 BJD 코드의 페이지 자동 순회. 최대 maxPages 도달 시 capped=true. */
async function fetchAllByBjd(
  bjdCode: string,
  maxPages: number,
): Promise<{ rows: BuildingTitleInfo[]; totalCount: number; capped: boolean }> {
  const all: BuildingTitleInfo[] = [];
  let totalCount = 0;
  let capped = false;

  for (let page = 1; page <= maxPages; page++) {
    const r = await listBuildingsByBjd(bjdCode, { pageNo: page, numOfRows: 100 });
    totalCount = r.totalCount;
    all.push(...r.rows);
    if (!r.hasMore) break;
    if (r.rows.length === 0) break;
    if (page === maxPages && r.hasMore) {
      capped = true;
      break;
    }
  }
  return { rows: all, totalCount, capped };
}

function numOrZero(v: string | null): number {
  if (v === null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(n)));
}
