/**
 * GET /api/capa/jibun-list-by-pnu?pnu=<19자리>
 *
 * KEPCO 가 같은 마을(bjd_code) 에 보유하고 있는 지번 텍스트 배열 반환.
 *
 * 흐름:
 *   1. PNU → bjd_code → bjd_master 에서 sep_1~5 조회
 *   2. buildKepcoCandidates 의 1차 후보로 callKepcoAddrGbn 호출
 *   3. ADDR_JIBUN 배열 반환 (정렬 X — KEPCO 응답 순서 그대로)
 *
 * 사용처:
 *   - ParcelInfoPanel [전기] 탭 "주변 지번" 섹터의 "지번 목록 불러오기" 버튼.
 *
 * fallback 후보 시도하지 않음 — 1차로 0건이면 그냥 0건.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildKepcoCandidates } from "@/lib/kepco-live/build-candidates";
import { callKepcoAddrGbn } from "@/lib/kepco-live/kepco-client";
import type { ParsedAddress } from "@/lib/kepco-live/parse-address";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "KEPCO live (retrieveAddrGbn) + bjd_master",
  cache: "no-store",
  auth: "user",
  inputs: [
    {
      name: "pnu",
      type: "string",
      required: true,
      sample: "4417025021103950003",
      description: "PNU 19자리 — 앞 10자리 bjd_code 로 마을 단위 지번 목록 조회.",
    },
  ],
  outputSchema:
    "{ ok, pnu, bjd_code, jibuns: string[], total }",
  externalDeps: ["kepco", "supabase"],
  notes:
    "KEPCO retrieveAddrGbn (gbn=4) 호출. buildKepcoCandidates 후보 순회 (첫 비어있지 않은 결과 채택) — 세종 si=do 변형 등 대응. DB 저장 없음 — 메모리/UI 일회성.",
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
  const supabase = createAdminClient();
  const { data: master, error: masterErr } = await supabase
    .from("bjd_master")
    .select("sep_1,sep_2,sep_3,sep_4,sep_5")
    .eq("bjd_code", bjdCode)
    .maybeSingle();

  if (masterErr) {
    console.error("[capa/jibun-list-by-pnu] bjd_master 조회 실패", masterErr);
    return NextResponse.json(
      { ok: false, error: masterErr.message },
      { status: 500 },
    );
  }
  if (!master) {
    return NextResponse.json(
      { ok: false, error: `bjd_code ${bjdCode} 가 bjd_master 에 없습니다.` },
      { status: 404 },
    );
  }

  const parsed: ParsedAddress = {
    sep_1: master.sep_1,
    sep_2: master.sep_2,
    sep_3: master.sep_3,
    sep_4: master.sep_4,
    sep_5: master.sep_5,
    jibun: "",
    original: "",
  };
  // search_capacity 와 동일 패턴: 후보 순회 + 첫 비어있지 않은 결과 채택.
  // 세종(si=do 변형) 등 1차로 0건 나오는 케이스 위해 필요.
  const candidates = buildKepcoCandidates(parsed);
  if (candidates.length === 0) {
    return NextResponse.json(
      { ok: true, pnu, bjd_code: bjdCode, jibuns: [], total: 0 },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    let jibuns: string[] = [];
    for (const c of candidates) {
      const list = await callKepcoAddrGbn({
        do: c.do,
        si: c.si,
        gu: c.gu,
        lidong: c.lidong,
        li: c.li,
      });
      if (list.length > 0) {
        jibuns = list;
        break;
      }
    }
    return NextResponse.json(
      { ok: true, pnu, bjd_code: bjdCode, jibuns, total: jibuns.length },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[capa/jibun-list-by-pnu] KEPCO 호출 실패", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
