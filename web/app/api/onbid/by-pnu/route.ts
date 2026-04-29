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
import type { OnbidDetail } from "@/lib/onbid/types";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

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
    "{ ok: true, pnu, items: OnbidDetail[], fetchedAt } — 매물 없으면 items 빈 배열",
  externalDeps: ["data.go.kr (캠코 OnbidRlstListSrvc2 + OnbidRlstDtlSrvc2)", "supabase (bjd_master)"],
  notes:
    "PNU 만으로 상세 조회 불가 (캠코는 cltrMngNo 키). " +
    "그래서 1) bjd_master 한글주소 → 2) 목록 호출 → 3) 매물의 보정 PNU 매칭 → 4) cltrMngNo 로 상세 호출. " +
    "외부 호출: 매물 없을 때 1번, 1건 있을 때 2번, N건 있을 때 1+N번. " +
    "⚠️ 캠코 ltnoPnu 의 산구분(11번째 자리)이 비표준(0=일반, 1=산) 으로 와서 행안부 표준(1=일반, 2=산) 으로 변환해 매칭. " +
    "변환 로직 lib/onbid/pnu-fix.ts (실측 100% 매칭, 500건 검증).",
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

    // 3) 매물의 보정 PNU(=행안부 표준) 와 입력 PNU 비교 + cltrMngNo 회차 중복 제거.
    //    캠코 ltnoPnu 는 산구분 비표준(0=일반/1=산) 이라 직접 비교하면 0% 매칭 →
    //    pnuFromOnbidItem 으로 매물명에서 표준 PNU 재구성 후 비교 (실측 100%).
    const matchedAll = listRes.items.filter(
      (it) => pnuFromOnbidItem(it) === pnu,
    );
    const dedupMap = new Map<string, (typeof matchedAll)[number]>();
    for (const it of matchedAll) {
      if (!dedupMap.has(it.cltrMngNo)) dedupMap.set(it.cltrMngNo, it);
    }
    const matched = [...dedupMap.values()];
    if (matched.length === 0) {
      return NextResponse.json(
        {
          ok: true,
          pnu,
          items: [],
          fetchedAt: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // 4) 매물 각각 상세 병렬 호출 + 좌표 enrich
    const baseItemsP = enrichRawItems(matched); // 좌표/카테고리/D-day
    const detailsP = Promise.all(
      matched.map((m) =>
        fetchOnbidDetail(m.cltrMngNo, m.pbctCdtnNo).catch((e) => {
          console.error(`[onbid/by-pnu] 상세 실패 cltrMngNo=${m.cltrMngNo}`, e);
          return null;
        }),
      ),
    );
    const [baseItems, details] = await Promise.all([baseItemsP, detailsP]);

    // 5) base + detail 결합
    const items: OnbidDetail[] = baseItems.map((base, i) => {
      const raw = details[i];
      if (!raw) {
        // 상세 호출 실패 — 목록 정보만이라도 OnbidDetail 형식으로 채워서 반환
        return enrichDetail(base, {
          ...matched[i],
        });
      }
      return enrichDetail(base, raw);
    });

    return NextResponse.json(
      {
        ok: true,
        pnu,
        items,
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
