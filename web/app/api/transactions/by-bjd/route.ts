/**
 * GET /api/transactions/by-bjd?bjd_code=...&months=12&kind=land|nrg
 *
 * Atomic endpoint — 시군구 단위 실거래가 조회 (토지 또는 상업·업무용).
 * 영업담당자의 시세 감각·협상 근거 자료.
 *
 * 입력:
 *   - bjd_code (10) — 행안부 법정동 코드. 앞 5자리 = LAWD_CD
 *   - months — 조회 개월 수 (1~24, 기본 12)
 *   - kind — "land" (default, 토지매매) | "nrg" (상업·업무용 부동산매매)
 *
 * 외부 호출: months 회 fan-out (사용자→서버는 1회)
 *   - kind=land → getRTMSDataSvcLandTrade (일일 1,000회 한도)
 *   - kind=nrg  → getRTMSDataSvcNrgTrade  (일일 10,000회 한도)
 *
 * 응답:
 *   { ok, bjd_code, kind, months, rows, stats }
 *
 * 캐시: private, s-maxage=21600 (6h) — 이번 달 분 매일 갱신 가능
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getLandTradesByBjd } from "@/lib/rtms/land-trade";
import { getNrgTradesByBjd } from "@/lib/rtms/nrg-trade";
import { computeLandStats, computeNrgStats } from "@/lib/rtms/trade-stats";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source:
    "국토부 RTMS — kind=land 시 getRTMSDataSvcLandTrade / kind=nrg 시 getRTMSDataSvcNrgTrade",
  cache: "private, s-maxage=21600, max-age=3600",
  auth: "user",
  inputs: [
    {
      name: "bjd_code",
      type: "string",
      required: true,
      sample: "4673025025",
      description: "행안부 법정동 코드 10자리. 앞 5자리 = LAWD_CD",
    },
    {
      name: "months",
      type: "number",
      required: false,
      sample: "12",
      description: "조회 개월 수 (1~24, 기본 12)",
    },
    {
      name: "kind",
      type: "string",
      required: false,
      sample: "land",
      description: "'land' (토지매매, 기본) | 'nrg' (상업·업무용)",
    },
  ],
  outputSchema:
    "{ ok, bjd_code, kind, months, rows: LandTransaction[]|NrgTransaction[], stats: { total, medianPricePerPyeong, trend, byCategory, monthly } }",
  externalDeps: ["rtms-land", "rtms-nrg"],
  notes:
    "atomic=1 외부=1 원칙 예외 — RTMS 가 시군구·월 단위 강제 → months 회 fan-out (Promise.all, 부분실패 허용). wrapper 가 bjd_code 시군구 정규화 → 같은 시군구 다른 지번도 cache hit. 6h CDN.",
};

type Kind = "land" | "nrg";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 },
    );
  }

  const bjdCode = request.nextUrl.searchParams.get("bjd_code")?.trim() ?? "";
  if (!/^\d{10}$/.test(bjdCode)) {
    return NextResponse.json(
      { ok: false, error: "bjd_code 는 10자리 숫자여야 합니다." },
      { status: 400 },
    );
  }

  const monthsRaw = Number(request.nextUrl.searchParams.get("months") ?? "12");
  const months =
    Number.isFinite(monthsRaw) && monthsRaw >= 1 && monthsRaw <= 24
      ? Math.floor(monthsRaw)
      : 12;

  const kindRaw = (request.nextUrl.searchParams.get("kind") ?? "land")
    .trim()
    .toLowerCase();
  const kind: Kind = kindRaw === "nrg" ? "nrg" : "land";

  try {
    const payload =
      kind === "nrg"
        ? await fetchNrg(bjdCode, months)
        : await fetchLand(bjdCode, months);
    return NextResponse.json(
      { ok: true, bjd_code: bjdCode, kind, months, ...payload },
      {
        headers: {
          "Cache-Control": "private, s-maxage=21600, max-age=3600",
        },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[transactions/by-bjd kind=${kind}] failed:`, msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}

async function fetchLand(bjdCode: string, months: number) {
  const rows = await getLandTradesByBjd(bjdCode, months);
  const stats = computeLandStats(rows, months);
  return { rows, stats };
}

async function fetchNrg(bjdCode: string, months: number) {
  const rows = await getNrgTradesByBjd(bjdCode, months);
  const stats = computeNrgStats(rows, months);
  return { rows, stats };
}
