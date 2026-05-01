/**
 * GET /api/capa/by-pnu?pnu=<19자리>
 *
 * Atomic endpoint — PNU 단위 KEPCO 용량 + 행정구역 메타.
 *
 * 입력: PNU 19자리 (행안부 표준, 산구분 1=일반/2=산).
 * 서버 분리:
 *   - bjd_code = PNU 앞 10자리
 *   - jibun = PNU 뒤 9자리 → 텍스트 ("36-2", "산23")
 *   - kepco_capa.addr_jibun 와 exact match
 *
 * 매칭 0건 fallback (2026-05-01 의뢰자 요청):
 *   같은 리(=같은 bjd_code) 안에서 본번 차이 최소 top 5 row 반환.
 *   RPC fallback_kepco_nearest 가 jibun_to_num 정규화 + 거리 정렬.
 *   한전이 모든 지번 데이터를 갖고 있지 않아 같은 마을 안의 다른 지번 정보로
 *   대체. UI 에는 fallback 사용 표시 + 안내 배지 (LocationDetailGrouped compact).
 *   응답 필드: fallback = { used: true, target_jibun }
 *
 * 응답:
 *   { ok, pnu, bjd_code, jibun, rows, total, meta, fallback }
 *
 * 사용처:
 *   - ParcelInfoPanel [전기] 탭 (lib/kepco/by-pnu) — 모든 진입(전기/공매/견적) 단일 입력 PNU.
 *
 * 마을(BJD) 단위 조회는 별도 endpoint:
 *   - 마을 카드:  /api/capa/summary-by-bjd
 *   - 마을 모달:  /api/capa/by-bjd
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { jibunFromPnu, jibunToNumber } from "@/lib/geo/pnu";
import type { AddrMeta, KepcoDataRow } from "@/lib/types";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "DB (Supabase: kepco_capa + bjd_master)",
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
    "exact match 만 — fallback 없음. KEPCO 미수집 지번은 빈 rows. meta = bjd_master 의 sep_1~5 (헤더 주소 표시용 보조). PNU → bjd_code/jibun 분리는 lib/geo/pnu (jibunFromPnu).",
};

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

  const supabase = createAdminClient();
  const [capaRes, metaRes] = await Promise.all([
    supabase
      .from("kepco_capa")
      .select("*")
      .eq("bjd_code", bjdCode)
      .eq("addr_jibun", jibun),
    supabase
      .from("bjd_master")
      .select("sep_1,sep_2,sep_3,sep_4,sep_5")
      .eq("bjd_code", bjdCode)
      .maybeSingle(),
  ]);

  if (capaRes.error) {
    console.error("[capa/by-pnu] 조회 실패", capaRes.error);
    return NextResponse.json(
      { ok: false, error: capaRes.error.message },
      { status: 500 },
    );
  }

  let rows = (capaRes.data ?? []) as KepcoDataRow[];
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

  // ── exact 매칭 0건 fallback (2026-05-01 의뢰자 결정) ───────────────
  // 같은 마을(bjd_code) 내 가장 가까운 지번 top 5 표시.
  // RPC fallback_kepco_nearest 가 jibun_to_num() 정규화 + 거리 정렬.
  // 정상 매칭 케이스는 추가 부담 0 — exact 0건일 때만 발동.
  //
  // village_empty (2026-05-01): RPC 결과도 빈 배열 = 마을 전체에 한전 데이터 0건.
  // 추가 쿼리 없이 같은 RPC 결과로 판정 → UI 에서 "마을 자체 정보 없음" 안내용.
  let fallback: { used: false } | { used: true; target_jibun: string } = {
    used: false,
  };
  let villageEmpty = false;
  if (rows.length === 0) {
    const targetNum = jibunToNumber(jibun);
    if (targetNum !== null) {
      const { data: nearestRows, error: rpcErr } = await supabase.rpc(
        "fallback_kepco_nearest",
        {
          p_bjd_code: bjdCode,
          p_target_num: targetNum,
          p_limit: 5,
        },
      );
      if (rpcErr) {
        console.error("[capa/by-pnu] fallback RPC 실패", rpcErr);
        // RPC 실패해도 응답 자체는 정상 (rows=[]) 으로 — UI 기존 흐름 유지
      } else if (nearestRows && nearestRows.length > 0) {
        rows = nearestRows as KepcoDataRow[];
        fallback = { used: true, target_jibun: jibun };
      } else {
        // RPC 정상 응답 + 빈 배열 = 같은 bjd_code 안에 row 0건 = 마을 전체 한전 데이터 없음
        villageEmpty = true;
      }
    }
  }

  return NextResponse.json(
    {
      ok: true,
      pnu,
      bjd_code: bjdCode,
      jibun,
      rows,
      total: rows.length,
      meta,
      fallback,
      village_empty: villageEmpty,
    },
    {
      // 같은 PNU 재호출 시 10분간 hit (KEPCO 일배치 갱신 주기 대비 충분히 안전)
      headers: { "Cache-Control": "private, max-age=600" },
    },
  );
}
