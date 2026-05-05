/**
 * GET /api/capa/by-pnu?pnu=<19자리>
 *
 * PNU 단위 KEPCO 용량 조회 — 같은 마을(bjd_code) 내 가까운 지번 top N.
 *
 * 입력: PNU 19자리 (행안부 표준, 산구분 1=일반/2=산).
 * 처리:
 *   - bjd_code = PNU 앞 10자리
 *   - jibun = PNU 뒤 9자리 → 텍스트 ("36-2", "산23")
 *   - jibunToNumber(jibun) 으로 정규화 숫자값
 *   - RPC fallback_kepco_nearest 호출 (자기 지번 포함, 거리순 top 10)
 *
 * 응답: { ok, pnu, bjd_code, jibun, rows, total, meta }
 *   rows = 같은 마을 가까운 지번 top N (자기 지번이 DB 에 있으면 1등으로 포함됨)
 *   클라이언트에서 buildPnuFromBjdAndJibun(row.bjd_code, row.addr_jibun) === pnu 로
 *   "해당 지번" / "주변 지번" 분기.
 *
 * 사용처:
 *   - ParcelInfoPanel [전기] 탭 (lib/kepco/by-pnu).
 *
 * 마을(BJD) 단위 조회는 별도 endpoint:
 *   - 마을 카드:  /api/capa/summary-by-bjd
 *   - 마을 모달:  /api/capa/by-bjd
 *
 * 변경 이력:
 *   2026-05-05: exact 매칭 + fallback 직렬 → RPC 단일 호출로 통합. 클라이언트가
 *               PNU 비교로 자기/주변 분기. API 호출 1회로 단축.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { jibunFromPnu, jibunToNumber } from "@/lib/geo/pnu";
import type { AddrMeta, KepcoDataRow } from "@/lib/types";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "DB (Supabase RPC: fallback_kepco_nearest + bjd_master)",
  cache: "no-store",
  auth: "user",
  inputs: [
    {
      name: "pnu",
      type: "string",
      required: true,
      sample: "4417025021103950003",
      description:
        "PNU 19자리 (bjd_code 10 + 산구분 1 + 본번 4 + 부번 4). 행안부 표준 (1=일반/2=산).",
    },
  ],
  outputSchema:
    "{ ok, pnu, bjd_code, jibun, rows: KepcoDataRow[], total, meta: AddrMeta | null }",
  externalDeps: [],
  notes:
    "RPC fallback_kepco_nearest 로 같은 마을 가까운 지번 top 10 (자기 포함). 클라이언트가 PNU 비교로 자기/주변 분기. meta = bjd_master sep_1~5 (헤더용 보조).",
};

const NEARBY_LIMIT = 10;

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 },
    );
  }

  const pnu = (request.nextUrl.searchParams.get("pnu") ?? "").trim();
  if (!/^\d{19}$/.test(pnu)) {
    return NextResponse.json(
      { ok: false, error: "PNU 형식 오류 (19자리 숫자 필요)" },
      { status: 400 },
    );
  }

  const bjdCode = pnu.slice(0, 10);
  const jibun = jibunFromPnu(pnu);
  if (!jibun) {
    return NextResponse.json(
      { ok: false, error: "PNU 에서 지번을 추출할 수 없습니다." },
      { status: 400 },
    );
  }

  const targetNum = jibunToNumber(jibun);
  const supabase = createAdminClient();

  // meta 는 어떤 경우든 같은 bjd_master 행 1건. RPC 와 병렬로.
  const metaPromise = supabase
    .from("bjd_master")
    .select("sep_1,sep_2,sep_3,sep_4,sep_5")
    .eq("bjd_code", bjdCode)
    .maybeSingle();

  // targetNum 이 null = 정규화 불가 (예: KEPCO 가 들고있지 않은 비표준 표기).
  // RPC 는 거리 정렬 기준이라 호출 의미 없음 → 빈 rows 로 응답.
  let rows: KepcoDataRow[] = [];
  if (targetNum !== null) {
    const { data, error } = await supabase.rpc("fallback_kepco_nearest", {
      p_bjd_code: bjdCode,
      p_target_num: targetNum,
      p_limit: NEARBY_LIMIT,
    });
    if (error) {
      console.error("[capa/by-pnu] RPC 실패", error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }
    rows = (data ?? []) as KepcoDataRow[];
  }

  const metaRes = await metaPromise;
  const m = metaRes.data;
  const meta: AddrMeta | null = m
    ? {
        sep_1: m.sep_1 || null,
        sep_2: m.sep_2 || null,
        sep_3: m.sep_3 || null,
        sep_4: m.sep_4 || null,
        sep_5: m.sep_5 || null,
      }
    : null;

  return NextResponse.json(
    {
      ok: true,
      pnu,
      bjd_code: bjdCode,
      jibun,
      rows,
      total: rows.length,
      meta,
    },
    {
      headers: { "Cache-Control": "private, max-age=600" },
    },
  );
}
