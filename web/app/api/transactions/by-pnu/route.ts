/**
 * GET /api/transactions/by-pnu?pnu=<19자리>&months=12&kind=land|nrg
 *
 * Atomic endpoint — PNU 단위 입력으로 시군구 단위 실거래가 조회.
 *
 * ⚠️ 데이터 단위 vs 입력 단위:
 *   - RTMS 데이터의 본질 단위 = "시군구" (LAWD_CD = bjd_code 앞 5자리).
 *   - 같은 시군구 안의 어느 PNU 든 동일한 결과 (시세 비교용).
 *   - 입력만 PNU 로 통일 (상세정보 팝업의 모든 탭이 PNU 단일 입력) — 서버에서 시군구 BJD 도출.
 *
 * 입력:
 *   - pnu (19) — 행안부 표준 PNU. 앞 5자리가 LAWD_CD.
 *   - months (1~24, 기본 12)
 *   - kind ("land" 토지매매 / "nrg" 상업·업무용)
 *
 * 외부 호출: months 회 fan-out (사용자→서버는 1회)
 *
 * 응답:
 *   { ok, pnu, sgg_bjd, kind, months, rows, stats }
 *
 * 캐시: private, s-maxage=21600 (6h) — 같은 시군구 다른 PNU 도 cache hit.
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
      name: "pnu",
      type: "string",
      required: true,
      sample: "4673025025104230011",
      description:
        "PNU 19자리 (앞 5자리 = LAWD_CD 시군구 코드). 행안부 표준.",
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
    "{ ok, pnu, sgg_bjd, kind, months, rows, stats: { total, medianPricePerPyeong, trend, byCategory, monthly } }",
  externalDeps: ["rtms-land", "rtms-nrg"],
  notes:
    "PNU 입력으로 통일했지만 데이터 단위는 시군구. 같은 시군구 다른 PNU 도 cache hit (서버 6h CDN). atomic=1 외부=1 원칙 예외 — RTMS 가 시군구·월 단위 강제 → months 회 fan-out (Promise.all, 부분실패 허용).",
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

  const pnu = (request.nextUrl.searchParams.get("pnu") ?? "").trim();
  if (!/^\d{19}$/.test(pnu)) {
    return NextResponse.json(
      { ok: false, error: "PNU 형식 오류 (19자리 숫자 필요)" },
      { status: 400 },
    );
  }
  // PNU → 시군구 BJD (앞 5자리 + "00000")
  const sggBjd = pnu.slice(0, 5) + "00000";

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
        ? await fetchNrg(sggBjd, months)
        : await fetchLand(sggBjd, months);
    return NextResponse.json(
      { ok: true, pnu, sgg_bjd: sggBjd, kind, months, ...payload },
      {
        headers: {
          "Cache-Control": "private, s-maxage=21600, max-age=3600",
        },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[transactions/by-pnu kind=${kind}] failed:`, msg);
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
