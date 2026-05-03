/**
 * GET /api/onbid/by-pnu?pnu=<19자리>
 *
 * Atomic endpoint — 특정 PNU 의 공매 매물 상세 (사진/감정평가 등 풍부 정보).
 *
 * 흐름:
 *   1. PNU 19자리 검증 → 앞 10자리 = bjd_code
 *   2. bjd_master 조회 (sep_1~5 한글주소) — 캠코 입력에 사용
 *   3. 캠코 목록 호출 (시도/시군구/읍면동 필터)
 *      → numOfRows=200 (한 동에 매물 200건 넘는 경우 거의 없음)
 *   4. 응답 매물 중 ltnoPnu === 우리 PNU 인 매물 필터
 *      → 매칭 0건이면 즉시 빈 배열 반환 (외부 1번)
 *   5. 매칭 매물 각자의 cltrMngNo 로 상세 호출 (Promise.all 병렬)
 *   6. enrichDetail → OnbidDetail[] 반환
 *
 * 응답:
 *   { ok: true, pnu, items: OnbidDetail[], fetchedAt }
 *   매물 없음 = items 빈 배열 (ok=true).
 *
 * 사용처:
 *   - ParcelInfoPanel [공매] 탭 — lazy fetch 출처
 *   - 모듈 캐시 (lib/onbid/by-pnu.ts) 가 같은 PNU 재방문 시 0회 호출 보장.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchOnbidListPage,
  fetchOnbidDetail,
  type OnbidListRawParams,
} from "@/lib/onbid/client";
import { enrichDetail, enrichRawItems } from "@/lib/onbid/enrich";
import { pnuFromOnbidItem } from "@/lib/onbid/pnu-fix";
import { jibunFromPnu } from "@/lib/geo/pnu";
import type { OnbidDetail, OnbidListItem } from "@/lib/onbid/types";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

/** by-pnu 응답의 fallback 필드 — KEPCO 패턴 미러.
 *  - exact 매칭 0건 + 마을에 매물 있음 → used:true + 마을 매물 목록 첨부
 *  - exact 매칭 0건 + 마을 전체 0건  → used:false (별도 village_empty=true 필드)
 *  - 정상 매칭 (1건↑)               → used:false (fallback 미발동) */
type OnbidByPnuFallback =
  | { used: false }
  | { used: true; target_jibun: string; villageItems: OnbidListItem[] };

export const meta: EndpointMeta = {
  source:
    "캠코 OnbidRlstListSrvc2/getRlstCltrList2 + OnbidRlstDtlSrvc2/getRlstDtlInf2 + bjd_master JOIN",
  cache: "no-store",
  auth: "user",
  inputs: [
    {
      name: "pnu",
      type: "string",
      required: true,
      sample: "4683034023000070000",
      description: "PNU 19자리 (지번 코드)",
    },
  ],
  outputSchema:
    "{ ok: true, pnu, items: OnbidDetail[], fallback, village_empty, fetchedAt }",
  externalDeps: ["onbid", "supabase"],
  notes:
    "캠코 OnbidRlstListSrvc2/getRlstCltrList2 + OnbidRlstDtlSrvc2/getRlstDtlInf2 + supabase bjd_master JOIN. PNU 만으로 상세 조회 불가 (캠코는 cltrMngNo 키). 그래서 1) bjd_master 한글주소 → 2) 목록 호출 → 3) 매물의 보정 PNU 매칭 → 4) cltrMngNo 로 상세 호출. 외부 호출: 매물 없을 때 1번, 1건 있을 때 2번, N건 있을 때 1+N번. ⚠️ 캠코 ltnoPnu 의 산구분(11번째 자리)이 비표준(0=일반, 1=산) 으로 와서 행안부 표준(1=일반, 2=산) 으로 변환해 매칭. 변환 로직 lib/onbid/pnu-fix.ts (실측 100% 매칭, 500건 검증).",
};

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 },
    );
  }

  const pnu = (req.nextUrl.searchParams.get("pnu") ?? "").trim();
  if (!/^\d{19}$/.test(pnu)) {
    return NextResponse.json(
      { ok: false, error: "PNU 형식 오류 (19자리 숫자 필요)" },
      { status: 400 },
    );
  }

  const bjdCode = pnu.slice(0, 10);

  try {
    // 1) bjd_master 조회 — 한글주소
    const supabase = createAdminClient();
    const { data: bjdRow, error: bjdErr } = await supabase
      .from("bjd_master")
      .select("sep_1, sep_2, sep_3, sep_4, sep_5")
      .eq("bjd_code", bjdCode)
      .maybeSingle();
    if (bjdErr) {
      return NextResponse.json(
        { ok: false, error: `bjd_master 조회 실패: ${bjdErr.message}` },
        { status: 500 },
      );
    }
    if (!bjdRow) {
      return NextResponse.json(
        {
          ok: true,
          pnu,
          items: [],
          fallback: { used: false } as OnbidByPnuFallback,
          village_empty: true, // 마을 정보 자체가 없으면 fallback 도 불가능 → empty 처리
          fetchedAt: new Date().toISOString(),
          warning: `bjd_master 에 ${bjdCode} 미수록`,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // 2) 캠코 목록 호출 — 동 단위
    const sigungu = [bjdRow.sep_2, bjdRow.sep_3].filter(Boolean).join(" ");
    const listParams: OnbidListRawParams = {
      pageNo: 1,
      numOfRows: 200, // 한 동에 매물 200건 넘는 경우 거의 없음
      prptDivCd: "0007",
      pvctTrgtYn: "N",
      cltrUsgLclsCtgrId: "10000",
      lctnSdnm: bjdRow.sep_1 ?? undefined,
      lctnSggnm: sigungu || undefined,
      lctnEmdNm: bjdRow.sep_4 ?? undefined,
    };
    const listRes = await fetchOnbidListPage(listParams);

    // 3) 매물의 보정 PNU(=행안부 표준) 와 입력 PNU 비교.
    //    입력 pnu = 우리 기준정보 (pnuStandard 와 동일 표준).
    //    캠코 raw 의 ltnoPnu 는 산구분 비표준 → pnuFromOnbidItem 으로 표준 변환 후 비교.
    //    (enrich 후 객체의 pnuStandard 와 같은 알고리즘이지만, 여기는 raw 단계이므로 함수 직접 호출.)
    //    회차 dedup + 회차 정보 보존은 enrichRawItems 안에서 일괄 처리.
    const matchedAll = listRes.items.filter(
      (it) => pnuFromOnbidItem(it) === pnu,
    );
    const baseItems = await enrichRawItems(matchedAll);

    // ── exact 매칭 0건 fallback (KEPCO 패턴 미러) ───────────────
    // 같은 마을(동) 안의 모든 공매 매물을 표시 — 갯수 cap 없음 (의뢰자 결정 2026-05-02).
    // listRes 는 이미 "이 동" 단위로 받아온 응답이라 추가 외부 호출 불필요 →
    // enrichRawItems 한 번 더 돌려서 회차 dedup + 좌표 보강만 하면 끝.
    // village_empty: listRes 자체가 0건 = 마을 전체에 공매 매물 없음.
    if (baseItems.length === 0) {
      const villageItems = await enrichRawItems(listRes.items);
      const villageEmpty = villageItems.length === 0;
      const fallback: OnbidByPnuFallback = villageEmpty
        ? { used: false }
        : {
            used: true,
            target_jibun: jibunFromPnu(pnu) ?? "",
            villageItems,
          };
      return NextResponse.json(
        {
          ok: true,
          pnu,
          items: [],
          fallback,
          village_empty: villageEmpty,
          fetchedAt: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // 4) 매물 각각 상세 병렬 호출 (대표 회차의 cltrMngNo + pbctCdtnNo 사용)
    const details = await Promise.all(
      baseItems.map((b) =>
        fetchOnbidDetail(b.cltrMngNo, b.pbctCdtnNo).catch((e) => {
          console.error(`[onbid/by-pnu] 상세 실패 cltrMngNo=${b.cltrMngNo}`, e);
          return null;
        }),
      ),
    );

    // 5) base + detail 결합. 상세 실패 시 목록 raw 를 fallback 으로 사용.
    //    matchedAll 첫 row(=대표 회차) 가 baseItems 의 enrich 원본이라 그대로 fallback.
    const matchedByMngNo = new Map(
      matchedAll.map((m) => [m.cltrMngNo, m] as const),
    );
    const items: OnbidDetail[] = baseItems.map((base, i) => {
      const raw =
        details[i] ?? matchedByMngNo.get(base.cltrMngNo) ?? matchedAll[i];
      return enrichDetail(base, raw);
    });

    return NextResponse.json(
      {
        ok: true,
        pnu,
        items,
        fallback: { used: false } as OnbidByPnuFallback,
        village_empty: false,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[onbid/by-pnu] error", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
