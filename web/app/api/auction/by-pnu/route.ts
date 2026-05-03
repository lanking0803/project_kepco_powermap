/**
 * GET /api/auction/by-pnu?pnu=<19자리>
 *
 * Atomic endpoint — 특정 PNU 의 경매 매물 조회 (Hyphen 경매다 API).
 *
 * 흐름 (캠코 onbid/by-pnu 미러):
 *   1. PNU 19자리 검증 → sido(2)/gugun(5)/dong(10) 슬라이스 (행안부 표준)
 *   2. Hyphen 진행물건검색 호출 — 면 단위 sweep (페이지당 10건, 최대 20페이지 cap)
 *   3. apiStatus 분기:
 *        - "ok": 매물 enrich → PNU 매칭 → 결과 반환
 *        - "auth_failed": 결제 만료/키 오류 → UI 가 배너 표시
 *        - "rate_limited": 테스트 모드 20초 제한 (운영 모드선 없을 예정)
 *        - "unavailable": 5xx / 네트워크 — 일시 장애
 *   4. PNU 매칭 0건 → fallback (같은 면 매물 villageItems 첨부)
 *
 * 응답:
 *   { ok: true, pnu, apiStatus, errCd, errMsg, items, fallback, village_empty, truncated, fetchedAt }
 *
 * 사용처:
 *   - ParcelInfoPanel [경매] 탭 — lazy fetch 출처
 *   - 모듈 캐시 (lib/hyphen/by-pnu.ts) 30분 TTL — 같은 PNU 재방문 시 호출 0
 *
 * 데이터 획득 제한 (의뢰자 결정 2026-05-02):
 *   - 면(里) 단위까지만 (dong = pnu[0:10])
 *   - 최대 20페이지 (= 200건) cap
 *   - 신선도 30분 TTL (클라이언트 모듈 캐시)
 *
 * 외부 호출: 정상 케이스 1~5번 (면 매물 갯수에 따라). 인증 실패 시 1번 후 즉시 종료.
 */

import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import {
  HYPHEN_MAX_PAGES,
  fetchAuctionVillageSweep,
} from "@/lib/hyphen/client";
import { enrichRawItems } from "@/lib/hyphen/enrich";
import type {
  AuctionByPnuFallback,
} from "@/lib/hyphen/by-pnu";
import { jibunFromPnu } from "@/lib/geo/pnu";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source:
    "Hyphen 경매다 /au0147001252 (진행물건검색) + bjd_master 역조회. 면 단위 sweep ≤ 20페이지 cap.",
  cache: "no-store",
  auth: "user",
  inputs: [
    {
      name: "pnu",
      type: "string",
      required: true,
      sample: "4157034033103470000",
      description: "PNU 19자리 (지번 코드). 검증 케이스: 김포시 대곶면 대명리 347",
    },
  ],
  outputSchema:
    "{ ok: true, pnu, apiStatus, errCd, errMsg, items: AuctionListItem[], fallback, village_empty, truncated, fetchedAt }",
  externalDeps: ["hyphen", "supabase"],
  notes: "Hyphen 진행물건검색 + supabase bjd_master 역조회로 좌표/PNU 보강. 면(里) 단위까지만 호출 (dong=pnu[0:10]). 최대 20페이지(= 200건) cap. 응답에 종결 매물(매각/취하 등) 도 포함됨 — UI 에서 진행상태 배지로 구분. Hyphen dong 필터는 실제로 '면' 단위 매칭 → 응답에 다른 리도 섞여 옴 → PNU 매칭으로 정확 필터. apiStatus=auth_failed 면 의뢰자 비즈머니 충전 또는 결제 만료 — UI 가 배너로 안내.",
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

  // 행안부 표준 슬라이스 — 그대로 Hyphen 입력으로 사용 가능
  const sido = pnu.slice(0, 2);
  const gugun = pnu.slice(0, 5);
  const dong = pnu.slice(0, 10);

  try {
    // 1) Hyphen 진행물건검색 — 면 단위 sweep (≤ 20페이지)
    const sweep = await fetchAuctionVillageSweep({ sido, gugun, dong });

    if (sweep.apiStatus !== "ok") {
      // 인증 실패 / 레이트리밋 / 일시 장애 — 빈 배열 + apiStatus 로 UI 안내
      return NextResponse.json(
        {
          ok: true,
          pnu,
          apiStatus: sweep.apiStatus,
          errCd: sweep.errCd,
          errMsg: sweep.errMsg,
          items: [],
          fallback: { used: false } as AuctionByPnuFallback,
          village_empty: false,
          truncated: false,
          fetchedAt: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // 2) raw → enrich (PNU 조립 + bjd_master 좌표)
    const villageItems = await enrichRawItems(sweep.items);

    // 3) PNU 매칭 — pnuStandard 와 입력 PNU 비교
    const matched = villageItems.filter((it) => it.pnuStandard === pnu);

    // 4) exact 매칭 0건 fallback (캠코 패턴 미러)
    if (matched.length === 0) {
      const villageEmpty = villageItems.length === 0;
      const fallback: AuctionByPnuFallback = villageEmpty
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
          apiStatus: "ok" as const,
          errCd: sweep.errCd,
          errMsg: sweep.errMsg,
          items: [],
          fallback,
          village_empty: villageEmpty,
          truncated: sweep.truncated,
          fetchedAt: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // 5) 정상 매칭 — 매물 표시
    return NextResponse.json(
      {
        ok: true,
        pnu,
        apiStatus: "ok" as const,
        errCd: sweep.errCd,
        errMsg: sweep.errMsg,
        items: matched,
        fallback: { used: false } as AuctionByPnuFallback,
        village_empty: false,
        truncated: sweep.truncated,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[auction/by-pnu] error", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
