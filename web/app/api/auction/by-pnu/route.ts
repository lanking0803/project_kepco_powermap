/**
 * GET /api/auction/by-pnu?pnu=<19자리>
 *
 * Atomic endpoint — 특정 PNU 의 경매 매물 조회. 채널 swap 라우트.
 *
 * 채널 분기 (env AUCTION_CHANNEL):
 *   - "hyphen"        → Hyphen 경매다 (백업)
 *   - 그 외 (기본)    → 법원경매정보재공 직접 호출
 *
 * 흐름 (양쪽 채널 공통):
 *   1. PNU 19자리 검증 → 슬라이스 (sido/sigungu/emdong)
 *   2. 채널별 sweep 호출
 *   3. apiStatus 분기 (정상 / 차단 / 일시 장애)
 *   4. enrich/어댑터 → AuctionListItem 배열 (PNU 합성됨)
 *   5. 입력 PNU 정확 매칭
 *   6. 매칭 0건 → 같은 마을 매물 fallback
 *
 * 응답:
 *   { ok: true, pnu, apiStatus, errCd, errMsg, items, fallback, village_empty, truncated, fetchedAt }
 *
 * 사용처:
 *   - ParcelInfoPanel [경매] 탭 — lazy fetch (모드 무관 PNU 단일 입력)
 *   - 모듈 캐시 (lib/hyphen/by-pnu.ts) 30분 TTL — 같은 PNU 재방문 호출 0
 *
 * 단위 정책 (의뢰자 결정 2026-05-04):
 *   - hyphen: 면(里) 단위 sweep (dong = pnu[0:10])
 *   - court : 읍면동 단위 sweep (emdCd = pnu[5:8])
 *     → court API 가 읍면동 입력 정상 수용 (사이트 검증 캡쳐 확인)
 *   - cap 20 페이지 / 신선도 30분 TTL
 */

import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";

// hyphen (백업 채널)
import { fetchAuctionVillageSweep } from "@/lib/hyphen/client";
import { enrichRawItems } from "@/lib/hyphen/enrich";
import type {
  AuctionByPnuFallback,
} from "@/lib/hyphen/by-pnu";
import type { HyphenApiStatus } from "@/lib/hyphen/types";

// court (기본 채널)
import { fetchAuctionByPnuCourt } from "@/lib/court-auction/by-pnu";

import { jibunFromPnu } from "@/lib/geo/pnu";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source:
    "법원경매(기본) 또는 Hyphen 경매다 (env AUCTION_CHANNEL 토글). 양쪽 채널 모두 같은 출력 (items / fallback). court=읍면동 sweep, hyphen=면 sweep, 모두 cap 20p.",
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
  externalDeps: ["court-auction-direct", "hyphen", "supabase"],
  notes:
    "채널 분기 (AUCTION_CHANNEL): hyphen=면 단위 sweep / 그 외=court 읍면동 단위 sweep. apiStatus 양쪽 channel 통일 (HyphenApiStatus 형). court 채널은 blocked/unavailable → unavailable 매핑. 모듈 캐시 TTL 30분 — 같은 PNU 재방문 호출 0.",
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

  const channel = process.env.AUCTION_CHANNEL === "hyphen" ? "hyphen" : "court";

  try {
    if (channel === "hyphen") {
      return await runHyphenChannel(pnu);
    }
    return await runCourtChannel(pnu);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[auction/by-pnu] error", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// ─── Court 채널 (기본) ────────────────────────────────────

async function runCourtChannel(pnu: string) {
  const result = await fetchAuctionByPnuCourt(pnu);

  // court CourtApiStatus → HyphenApiStatus 매핑 (UI 가 hyphen 형 기대)
  const apiStatus: HyphenApiStatus =
    result.apiStatus === "blocked" || result.apiStatus === "unavailable"
      ? "unavailable"
      : result.apiStatus === "empty"
        ? "ok" // 빈 응답도 정상 처리, villageEmpty 로 분기
        : result.apiStatus; // "ok"

  // 비정상 — items 비우고 안내
  if (apiStatus === "unavailable") {
    return NextResponse.json(
      {
        ok: true,
        pnu,
        apiStatus,
        errCd: "",
        errMsg: result.errMsg,
        items: [],
        fallback: { used: false } as AuctionByPnuFallback,
        village_empty: false,
        truncated: false,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // 매칭 0건 + 읍면동 매물 ≥1건 → fallback
  if (result.items.length === 0 && !result.villageEmpty) {
    const fallback: AuctionByPnuFallback = {
      used: true,
      target_jibun: result.targetJibun,
      villageItems: result.villageItems,
    };
    return NextResponse.json(
      {
        ok: true,
        pnu,
        apiStatus: "ok" as const,
        errCd: "",
        errMsg: "",
        items: [],
        fallback,
        village_empty: false,
        truncated: result.truncated,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // 읍면동 자체 0건
  if (result.villageEmpty) {
    return NextResponse.json(
      {
        ok: true,
        pnu,
        apiStatus: "ok" as const,
        errCd: "",
        errMsg: "",
        items: [],
        fallback: { used: false } as AuctionByPnuFallback,
        village_empty: true,
        truncated: false,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // 정상 매칭
  return NextResponse.json(
    {
      ok: true,
      pnu,
      apiStatus: "ok" as const,
      errCd: "",
      errMsg: "",
      items: result.items,
      fallback: { used: false } as AuctionByPnuFallback,
      village_empty: false,
      truncated: result.truncated,
      fetchedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// ─── Hyphen 채널 (백업) ──────────────────────────────────

async function runHyphenChannel(pnu: string) {
  // 행안부 표준 슬라이스 — 그대로 Hyphen 입력으로 사용 가능
  const sido = pnu.slice(0, 2);
  const gugun = pnu.slice(0, 5);
  const dong = pnu.slice(0, 10);

  // 1) Hyphen 진행물건검색 — 면 단위 sweep (≤ 20페이지)
  const sweep = await fetchAuctionVillageSweep({ sido, gugun, dong });

  if (sweep.apiStatus !== "ok") {
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

  // 3) PNU 매칭
  const matched = villageItems.filter((it) => it.pnuStandard === pnu);

  // 4) exact 매칭 0건 fallback
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

  // 5) 정상 매칭
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
}
