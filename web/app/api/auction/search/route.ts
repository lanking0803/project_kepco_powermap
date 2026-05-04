/**
 * GET /api/auction/search
 *
 * 경매 매물 검색 — 채널 swap 라우트.
 *
 * 채널 분기:
 *   - process.env.AUCTION_CHANNEL === "hyphen"  → Hyphen 경매다 API
 *   - 그 외 (기본값 "court")                  → 법원경매정보재공 직접 호출
 *
 * 의뢰자 합의 (2026-05-04):
 *   - 운영 채널 결정 자율권 (의뢰자에게 보고 의무 없음)
 *   - 출력 타입은 hyphen ↔ court 동일 (AuctionListItem) — UI 변경 0
 *   - 차단/장애 시 환경변수 토글로 즉시 swap
 *
 * 입력 파라미터 (UI 와 동일):
 *   - sigunguCode (필수, 5자리 BJD prefix) / sidoName / emdong
 *   - yongdoCodes (콤마 join, hyphen 코드체계 — court 분기에서 자동 변환)
 *   - progressStatus (콤마 join — 양쪽 채널 모두 사후 필터)
 *   - landMin/Max, bareaMin/Max (㎡)
 *   - gamMin/Max, lowMin/Max (만원 단위 입력)
 *   - bidStart/End (YYYY-MM-DD)
 *   - usbdMin/Max (유찰횟수)
 *   - discountMin/Max (% — 채널별 의미 다름. hyphen=감정가 대비, court=사이트 정의)
 *
 * 응답:
 *   { ok: true, apiStatus, items: AuctionListItem[], totalCountAll, truncated, fetchedAt }
 *
 * 캐시: no-store (검색 결과 신선도 우선)
 */

import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";

// court (기본 채널)
import { courtToAuctionItems } from "@/lib/court-auction/adapter";
import { fetchCourtSweep } from "@/lib/court-auction/sweep";
import { mapHyphenYongdoToCourt } from "@/lib/court-auction/usage-map";

// hyphen (백업 채널)
import { fetchAuctionVillageSweep } from "@/lib/hyphen/client";
import { enrichRawItems } from "@/lib/hyphen/enrich";
import type {
  AuctionListItem,
  AuctionRawListItem,
  AuctionSearchParams,
  HyphenApiStatus,
} from "@/lib/hyphen/types";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source:
    "법원경매(기본) 또는 Hyphen 경매다 (env AUCTION_CHANNEL 토글). 출력 타입은 양쪽 채널 동일 (AuctionListItem).",
  cache: "no-store",
  auth: "user",
  inputs: [
    { name: "sigunguCode", type: "string", required: true, sample: "46770", description: "행안부 5자리. 비용 가드 — 시도만 검색 거부" },
    { name: "sidoName", type: "string", required: false, sample: "전라남도", description: "시도 한글명 — enrich 동명이리 충돌 방지용 (sep_1 매칭). 비우면 매칭 생략" },
    { name: "emdong", type: "string", required: false, sample: "", description: "읍면동 텍스트. 응답 후 클라이언트 LIKE 필터 (양쪽 채널 공통 사후)" },
    { name: "yongdoCodes", type: "string", required: false, sample: "31,33", description: "Hyphen 용도코드 다중 (콤마, 빈 문자=전체). court 채널에선 내부 매핑 후 sweep" },
    { name: "progressStatus", type: "string", required: false, sample: "신건,진행,유찰", description: "한글 진행상태 다중 (콤마, 빈 문자=전체). 응답 후 필터 (양쪽 채널 공통)" },
    { name: "landMin", type: "number", required: false, sample: "", description: "토지면적 ㎡ (court 채널에선 통합 면적 으로 매핑)" },
    { name: "landMax", type: "number", required: false, sample: "" },
    { name: "bareaMin", type: "number", required: false, sample: "", description: "건물면적 ㎡ (court 채널에선 통합 면적 으로 매핑)" },
    { name: "bareaMax", type: "number", required: false, sample: "" },
    { name: "gamMin", type: "number", required: false, sample: "", description: "감정가 만원" },
    { name: "gamMax", type: "number", required: false, sample: "" },
    { name: "lowMin", type: "number", required: false, sample: "", description: "최저가 만원" },
    { name: "lowMax", type: "number", required: false, sample: "" },
    { name: "bidStart", type: "string", required: false, sample: "2026-05-03", description: "매각기일 시작 YYYY-MM-DD" },
    { name: "bidEnd", type: "string", required: false, sample: "2026-11-03" },
    { name: "usbdMin", type: "number", required: false, sample: "", description: "유찰횟수 (court=서버, hyphen=사후)" },
    { name: "usbdMax", type: "number", required: false, sample: "" },
    { name: "discountMin", type: "number", required: false, sample: "30", description: "할인율 % (court=서버 lwsDspslPrcRate, hyphen=사후)" },
    { name: "discountMax", type: "number", required: false, sample: "" },
  ],
  outputSchema:
    "{ ok: true, apiStatus, items: AuctionListItem[], totalCountAll, truncated, fetchedAt }",
  externalDeps: ["court-auction-direct", "hyphen", "supabase"],
  notes:
    "운영 채널은 환경변수 AUCTION_CHANNEL 로 결정 (기본=court). 의뢰자 합의 — 채널 결정 자율권 + 월 10만 유지보수비. court 채널은 풍부한 서버 필터(용도/매각기일/감정가/할인율/유찰/특이사항) 사용 — 사후 필터는 진행상태/읍면동/면적 일부만. hyphen 채널은 기존 동작 그대로.",
};

// ─── 공통 입력 파싱 결과 ─────────────────────────────────
interface ParsedInput {
  sigunguCode: string;
  sido: string;
  sidoName: string | null;
  emdong: string;
  yongdoCodes: string[];
  progressStatus: string[];
  landMin: number | null;
  landMax: number | null;
  bareaMin: number | null;
  bareaMax: number | null;
  gamMinMan: number | null;
  gamMaxMan: number | null;
  lowMinMan: number | null;
  lowMaxMan: number | null;
  usbdMin: number | null;
  usbdMax: number | null;
  discountMin: number | null;
  discountMax: number | null;
  bidStart: string | null;
  bidEnd: string | null;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 },
    );
  }

  const sp = req.nextUrl.searchParams;
  const sigunguCode = (sp.get("sigunguCode") ?? "").trim();
  if (!/^\d{5}$/.test(sigunguCode)) {
    return NextResponse.json(
      {
        ok: false,
        error: "시군구를 선택해주세요.",
      },
      { status: 400 },
    );
  }

  const num = (key: string): number | null => {
    const v = sp.get(key);
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const splitCsv = (key: string): string[] =>
    (sp.get(key) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const input: ParsedInput = {
    sigunguCode,
    sido: sigunguCode.slice(0, 2),
    sidoName: (sp.get("sidoName") ?? "").trim() || null,
    emdong: (sp.get("emdong") ?? "").trim(),
    yongdoCodes: splitCsv("yongdoCodes"),
    progressStatus: splitCsv("progressStatus"),
    landMin: num("landMin"),
    landMax: num("landMax"),
    bareaMin: num("bareaMin"),
    bareaMax: num("bareaMax"),
    gamMinMan: num("gamMin"),
    gamMaxMan: num("gamMax"),
    lowMinMan: num("lowMin"),
    lowMaxMan: num("lowMax"),
    usbdMin: num("usbdMin"),
    usbdMax: num("usbdMax"),
    discountMin: num("discountMin"),
    discountMax: num("discountMax"),
    bidStart: sp.get("bidStart") || null,
    bidEnd: sp.get("bidEnd") || null,
  };

  // ── 채널 토글 ─────────────────────────────────────────
  // 의뢰자 합의: 기본 = court (법원경매 직접 호출). hyphen 은 백업.
  const channel = process.env.AUCTION_CHANNEL === "hyphen" ? "hyphen" : "court";

  try {
    const result =
      channel === "court"
        ? await runCourtChannel(input)
        : await runHyphenChannel(input);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[auction/search] channel=${channel} error`, e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// ─── 채널 1: 법원경매 직접 호출 (기본) ────────────────────

async function runCourtChannel(input: ParsedInput) {
  // 만원 → 원
  const toWon = (man: number | null): string =>
    man == null ? "" : String(Math.round(man * 10000));

  // YYYY-MM-DD → YYYYMMDD
  const ymd = (d: string | null): string =>
    d ? d.replace(/-/g, "") : "";

  // 면적 — court 는 통합 1개 필드. land/barea 둘 중 입력된 값을 합쳐 넓은 범위로 보냄.
  // (서버 1차 필터 후 사후 필터 단계에서 토지/건물 구분으로 재거름 가능 — 현재는 1차만)
  const areaMin = pickAreaMin(input.landMin, input.bareaMin);
  const areaMax = pickAreaMax(input.landMax, input.bareaMax);

  // hyphen yongdo 코드 → court 트리플 (1:N 매핑, 다중 sweep)
  const triples = mapHyphenYongdoToCourt(input.yongdoCodes);

  const sweep = await fetchCourtSweep(
    {
      sdCd: input.sido,
      sggCd: input.sigunguCode.slice(2, 5),
      pageSize: 50,
      bidBgngYmd: ymd(input.bidStart),
      bidEndYmd: ymd(input.bidEnd),
      aeeEvlAmtMin: toWon(input.gamMinMan),
      aeeEvlAmtMax: toWon(input.gamMaxMan),
      lwsDspslPrcMin: toWon(input.lowMinMan),
      lwsDspslPrcMax: toWon(input.lowMaxMan),
      lwsDspslPrcRateMin:
        input.discountMin == null ? "" : String(Math.round(input.discountMin)),
      lwsDspslPrcRateMax:
        input.discountMax == null ? "" : String(Math.round(input.discountMax)),
      objctArDtsMin: areaMin,
      objctArDtsMax: areaMax,
      flbdNcntMin:
        input.usbdMin == null ? "" : String(Math.round(input.usbdMin)),
      flbdNcntMax:
        input.usbdMax == null ? "" : String(Math.round(input.usbdMax)),
      rletDspslSpcCondCd: "",
    },
    triples,
  );

  if (sweep.apiStatus === "blocked" || sweep.apiStatus === "unavailable") {
    return {
      ok: true,
      apiStatus:
        sweep.apiStatus === "blocked"
          ? ("unavailable" as HyphenApiStatus)
          : ("unavailable" as HyphenApiStatus),
      errCd: "",
      errMsg: sweep.errMsg ?? "법원경매 사이트 일시 장애 — 잠시 후 재시도",
      items: [] as AuctionListItem[],
      totalCountAll: 0,
      truncated: false,
      fetchedAt: new Date().toISOString(),
    };
  }

  // 어댑터 — court raw → AuctionListItem
  const items = await courtToAuctionItems(sweep.items);

  // ── 사후 필터 (서버가 못 걸러주는 항목만) ──
  const filtered = items.filter((it) => {
    // 진행상태 — court 응답에 직접 필드 없음 → 어댑터가 휴리스틱으로 채움
    if (input.progressStatus.length > 0 && !input.progressStatus.includes(it.진행상태)) {
      return false;
    }
    // 읍면동 LIKE
    if (input.emdong) {
      const addr = `${it.대표소재지} ${it.리스트지번주소}`;
      if (!addr.includes(input.emdong)) return false;
    }
    return true;
  });

  return {
    ok: true,
    apiStatus: "ok" as HyphenApiStatus,
    errCd: "200",
    errMsg: "",
    items: filtered,
    totalCountAll: sweep.totalCntAll,
    truncated: sweep.truncated,
    fetchedAt: new Date().toISOString(),
  };
}

/** 토지/건물 통합 면적 최소 — 둘 중 하나만 입력 시 그 값, 둘 다면 작은 값. */
function pickAreaMin(landMin: number | null, bareaMin: number | null): string {
  const vals = [landMin, bareaMin].filter((v): v is number => v != null);
  if (vals.length === 0) return "";
  return String(Math.min(...vals.map((v) => Math.round(v))));
}

/** 토지/건물 통합 면적 최대 — 둘 중 하나만 입력 시 그 값, 둘 다면 큰 값. */
function pickAreaMax(landMax: number | null, bareaMax: number | null): string {
  const vals = [landMax, bareaMax].filter((v): v is number => v != null);
  if (vals.length === 0) return "";
  return String(Math.max(...vals.map((v) => Math.round(v))));
}

// ─── 채널 2: Hyphen (백업) ─────────────────────────────────

async function runHyphenChannel(input: ParsedInput) {
  // 만원 단위 → 원 단위 (Hyphen 검색 파라미터)
  const toWon = (man: number | null): string | undefined =>
    man == null ? undefined : String(Math.round(man * 10000));

  const baseHyphenParams: Omit<AuctionSearchParams, "yongdo" | "page"> = {
    sido: input.sido,
    gugun: input.sigunguCode,
    larea_min: input.landMin == null ? undefined : String(Math.round(input.landMin)),
    larea_max: input.landMax == null ? undefined : String(Math.round(input.landMax)),
    barea_min: input.bareaMin == null ? undefined : String(Math.round(input.bareaMin)),
    barea_max: input.bareaMax == null ? undefined : String(Math.round(input.bareaMax)),
    gamMin: toWon(input.gamMinMan),
    gamMax: toWon(input.gamMaxMan),
    lowMin: toWon(input.lowMinMan),
    lowMax: toWon(input.lowMaxMan),
    sday_s: input.bidStart ?? undefined,
    sday_e: input.bidEnd ?? undefined,
  };

  // 빈 배열 = 전체 (yongdo 미지정 1회 호출)
  const yongdosToCall = input.yongdoCodes.length === 0 ? [undefined] : input.yongdoCodes;

  const sweeps = await Promise.all(
    yongdosToCall.map((yongdo) =>
      fetchAuctionVillageSweep({
        ...baseHyphenParams,
        ...(yongdo ? { yongdo } : {}),
      }),
    ),
  );

  // 첫 번째 비정상 status = 사용자 안내용 대표값
  const firstFail = sweeps.find((s) => s.apiStatus !== "ok");
  if (firstFail) {
    return {
      ok: true,
      apiStatus: firstFail.apiStatus as HyphenApiStatus,
      errCd: firstFail.errCd,
      errMsg: firstFail.errMsg,
      items: [] as AuctionListItem[],
      totalCountAll: 0,
      truncated: false,
      fetchedAt: new Date().toISOString(),
    };
  }

  // ── union dedup (경매번호 기준) ────────────────────
  const merged: Map<number, AuctionRawListItem> = new Map();
  let truncated = false;
  let totalCountAll = 0;
  for (const s of sweeps) {
    truncated = truncated || s.truncated;
    totalCountAll += s.totallist;
    for (const it of s.items) {
      if (!merged.has(it.경매번호)) {
        merged.set(it.경매번호, it);
      }
    }
  }
  const rawItems = Array.from(merged.values());

  // ── enrich (PNU + 좌표 + daysLeft + discountRatio + 사건명칭) ──
  const enriched = await enrichRawItems(rawItems, input.sidoName);

  // ── 클라이언트 사이드 필터 ────────────────────────
  const filtered = enriched.filter((it) => {
    if (input.progressStatus.length > 0 && !input.progressStatus.includes(it.진행상태)) {
      return false;
    }
    if (input.usbdMin != null && it.유찰수 < input.usbdMin) return false;
    if (input.usbdMax != null && it.유찰수 > input.usbdMax) return false;
    const discountPct = it.discountRatio * 100;
    if (input.discountMin != null && discountPct < input.discountMin) return false;
    if (input.discountMax != null && discountPct > input.discountMax) return false;
    if (input.emdong) {
      const addr = `${it.대표소재지} ${it.리스트지번주소}`;
      if (!addr.includes(input.emdong)) return false;
    }
    return true;
  });

  return {
    ok: true,
    apiStatus: "ok" as HyphenApiStatus,
    errCd: "200",
    errMsg: "",
    items: filtered,
    totalCountAll,
    truncated,
    fetchedAt: new Date().toISOString(),
  };
}
