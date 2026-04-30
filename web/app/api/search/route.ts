/**
 * GET /api/search?addr=...&jibun=...
 *
 * 042 재설계 — 한글 주소칸 + 지번칸 분리 입력. 폴백 없음.
 *
 *   addr   : 행정구역 자유 텍스트 (예: "충남 부여군 장암면 지토리")
 *   jibun  : 본번-부번 (예: "29-4" / "29")
 *
 * 응답 schema:
 *   {
 *     ok: boolean,
 *     ri: SearchRiResult[],   // 1단계 후보 중 kepco_capa 데이터 있는 마을 (cnt>0)
 *     ji: KepcoDataRow[],     // 2단계 결과. 1단계 1건 + lotMain 있을 때만 채워짐
 *     parsed: { addrNormalized, lotMain, lotSub, jibunInvalid }
 *   }
 *
 * 흐름:
 *   1) parseSearchInput — 한글 정규화 + 지번 정규식
 *   2) jibunInvalid → 에러 안내 (ok: false)
 *   3) 둘 다 비면 빈 결과
 *   4) 한글 비었는데 지번만 있으면 안내 (ok: false)
 *   5) searchAddress 호출 — 1단계 후보 + 마을 정보
 *   6) cnt>0 인 후보 1건 + lotMain 있으면 → searchJibun 자동 호출
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { parseSearchInput } from "@/lib/search/parseQuery";
import {
  searchAddress,
  searchJibun,
  toSearchRiResult,
  type SearchRiResult,
} from "@/lib/search/searchKepco";
import type { KepcoDataRow } from "@/lib/types";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "DB (lib/search/searchKepco — search_address RPC + kepco_capa 직접 쿼리, 042)",
  cache: "no-store",
  auth: "user",
  inputs: [
    {
      name: "addr",
      type: "string",
      required: false,
      sample: "충남 부여군 장암면 지토리",
      description: "한글 행정구역. 시/도 약어(충남/경남 등) 자동 치환. 정규화 후 LIKE 매칭.",
    },
    {
      name: "jibun",
      type: "string",
      required: false,
      sample: "29-4",
      description: "본번-부번. '29' 또는 '29-4' 형식. 잘못된 형식이면 jibunInvalid:true.",
    },
  ],
  outputSchema:
    "{ ok, ri: SearchRiResult[], ji: KepcoDataRow[], parsed: { addrNormalized, lotMain, lotSub, jibunInvalid } }",
  externalDeps: ["supabase"],
  notes: "ri 는 1단계 후보 중 kepco_capa 데이터 있는 마을만(cnt>0). ji 는 ri 1건 + lotMain 있을 때만. 폴백 없음.",
};

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  const addr = request.nextUrl.searchParams.get("addr") ?? "";
  const jibun = request.nextUrl.searchParams.get("jibun") ?? "";
  const parsed = parseSearchInput(addr, jibun);

  // 잘못된 지번 형식
  if (parsed.jibunInvalid) {
    return NextResponse.json({
      ok: false,
      error: "지번은 '29' 또는 '29-4' 형식으로 입력해 주세요.",
      parsed,
    });
  }

  // 둘 다 비면 빈 결과 (DB 호출 없이)
  if (!parsed.addrNormalized && parsed.lotMain === null) {
    return NextResponse.json({
      ok: true,
      ri: [],
      ji: [],
      parsed,
    });
  }

  // 지번만 있고 주소가 비면 안내
  if (!parsed.addrNormalized && parsed.lotMain !== null) {
    return NextResponse.json({
      ok: false,
      error: "주소(시·도 또는 동·리)를 함께 입력해 주세요.",
      parsed,
    });
  }

  try {
    // ── 1단계: 한글 → bjd_master 후보 ───────────────
    const addrResult = await searchAddress(parsed.addrNormalized);

    // 후보 중 kepco_capa 데이터 있는 마을만 ri 로 매핑.
    // 데이터 없는 마을은 검색 결과로 의미 없음 (선로 정보 0건).
    const validMatches = addrResult.matches.filter((m) => (m.cnt ?? 0) > 0);
    const ri: SearchRiResult[] = validMatches.map(toSearchRiResult);

    // ── 2단계: 후보 1건 + 본번 있을 때만 ────────────
    let ji: KepcoDataRow[] = [];

    if (validMatches.length === 1 && parsed.lotMain !== null) {
      const jibunResult = await searchJibun(
        validMatches[0].bjd_code,
        parsed.lotMain,
        parsed.lotSub
      );
      ji = jibunResult.ji;
    }

    return NextResponse.json({
      ok: true,
      ri,
      ji,
      parsed,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[search] 실패", err);
    return NextResponse.json(
      { ok: false, error: msg, parsed },
      { status: 500 }
    );
  }
}
