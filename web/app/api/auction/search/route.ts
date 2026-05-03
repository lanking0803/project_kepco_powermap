/**
 * GET /api/auction/search
 *
 * Atomic endpoint — Hyphen 진행물건검색(au0147001252) + 우리 enrich.
 *
 * 흐름:
 *   1. 쿼리 파라미터 → AuctionSearchParams 매핑 (Hyphen 형식)
 *   2. yongdoCodes 다중 = 코드별 병렬 sweep (Hyphen 단일 호출 한계 우회)
 *   3. enrichRawItems → AuctionListItem (lat/lng, pnuStandard, daysLeft, discountRatio)
 *   4. 클라이언트 사이드 필터 (Hyphen 검색 파라미터에 없는 항목들):
 *      - progressStatus 한글 분류 (응답 정렬이 종결건 우선이라 필수)
 *      - usbdMin/Max (유찰횟수)
 *      - discountMin/Max (할인율 %, 응답 후 계산)
 *      - emdong 텍스트 LIKE (Hyphen dong 코드 변환 데이터 부재 → 사후 필터)
 *
 * 비용 가드 (의뢰자 결정 2026-05-02):
 *   - sigunguCode 필수 (시도만 검색 거부) — Hyphen 호출당 종량 결제 부담 회피
 *   - 페이지 sweep 최대 20페이지 cap (HYPHEN_MAX_PAGES)
 *   - 다중 yongdo 시 호출 수 = 코드 수 × 페이지 수 → 사용자에게 명시적 안내 (UI)
 *
 * 응답:
 *   { ok: true, apiStatus, items: AuctionListItem[], totalCountAll, truncated, fetchedAt }
 *
 * 사용처:
 *   - AuctionSearchPanel 검색 버튼 → 결과 카드 + 지도 마커
 *
 * 캐시: no-store (검색 결과 신선도 우선). 비용 부담은 sigunguCode 필수로 흡수.
 */

import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
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
    "Hyphen 경매다 /au0147001252 (진행물건검색) + bjd_master 역조회. 다중 yongdo 병렬 sweep + 클라이언트 사이드 필터.",
  cache: "no-store",
  auth: "user",
  inputs: [
    { name: "sigunguCode", type: "string", required: true, sample: "41570", description: "행안부 5자리. 비용 가드 — 시도만 검색 거부" },
    { name: "emdong", type: "string", required: false, sample: "", description: "읍면동 텍스트. 응답 후 클라이언트 LIKE 필터" },
    { name: "yongdoCodes", type: "string", required: false, sample: "31,33", description: "Hyphen 용도코드 다중 (콤마, 빈 문자=전체)" },
    { name: "progressStatus", type: "string", required: false, sample: "신건,진행,유찰", description: "한글 진행상태 다중 (콤마, 빈 문자=전체). 응답 후 필터" },
    { name: "landMin", type: "number", required: false, sample: "", description: "토지면적 ㎡" },
    { name: "landMax", type: "number", required: false, sample: "" },
    { name: "bareaMin", type: "number", required: false, sample: "", description: "건물면적 ㎡" },
    { name: "bareaMax", type: "number", required: false, sample: "" },
    { name: "gamMin", type: "number", required: false, sample: "", description: "감정가 만원" },
    { name: "gamMax", type: "number", required: false, sample: "" },
    { name: "lowMin", type: "number", required: false, sample: "", description: "최저가 만원" },
    { name: "lowMax", type: "number", required: false, sample: "" },
    { name: "bidStart", type: "string", required: false, sample: "2026-05-03", description: "매각기일 시작 YYYY-MM-DD" },
    { name: "bidEnd", type: "string", required: false, sample: "2026-11-03" },
    { name: "usbdMin", type: "number", required: false, sample: "", description: "유찰횟수 — 응답 후 필터" },
    { name: "usbdMax", type: "number", required: false, sample: "" },
    { name: "discountMin", type: "number", required: false, sample: "30", description: "할인율 % — 응답 후 계산 + 필터" },
    { name: "discountMax", type: "number", required: false, sample: "" },
  ],
  outputSchema:
    "{ ok: true, apiStatus, items: AuctionListItem[], totalCountAll, truncated, fetchedAt }",
  externalDeps: ["hyphen", "supabase (bjd_master)"],
  notes:
    "다중 yongdo 는 Hyphen 단일 코드 한계로 코드별 병렬 sweep + 경매번호 dedup. " +
    "응답에 종결매물(매각/취하) 도 포함되므로 progressStatus 클라이언트 필터 필수 — " +
    "기본 권장: ['신건','진행','유찰']. 매각기일 미래 윈도우(예: 오늘 ~ +6개월) 도 함께 적용 권장. " +
    "테스트 모드(HYPHEN_OPERATION_MODE !== 'Y')에선 20초 레이트리밋으로 다중 sweep 시 매우 느림 — " +
    "운영 모드 전환 후 정상 속도. 인증/잔액 실패 시 apiStatus 로 UI 배너 안내.",
};

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
        error: "시군구를 선택해주세요. (Hyphen 호출 비용 절감)",
      },
      { status: 400 },
    );
  }
  const sido = sigunguCode.slice(0, 2);

  // ── 입력 파싱 ─────────────────────────────────────────
  const yongdoCodesRaw = sp.get("yongdoCodes") ?? "";
  const yongdoCodes = yongdoCodesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const progressStatusRaw = sp.get("progressStatus") ?? "";
  const progressStatus = progressStatusRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const emdong = (sp.get("emdong") ?? "").trim();

  const num = (key: string): number | null => {
    const v = sp.get(key);
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const landMin = num("landMin");
  const landMax = num("landMax");
  const bareaMin = num("bareaMin");
  const bareaMax = num("bareaMax");
  const gamMinMan = num("gamMin");
  const gamMaxMan = num("gamMax");
  const lowMinMan = num("lowMin");
  const lowMaxMan = num("lowMax");
  const usbdMin = num("usbdMin");
  const usbdMax = num("usbdMax");
  const discountMin = num("discountMin");
  const discountMax = num("discountMax");

  const bidStart = sp.get("bidStart") || null;
  const bidEnd = sp.get("bidEnd") || null;

  // 만원 단위 → 원 단위 (Hyphen 검색 파라미터)
  const toWon = (man: number | null): string | undefined =>
    man == null ? undefined : String(Math.round(man * 10000));

  // ── Hyphen 호출 파라미터 (단일 yongdo 분할 호출) ──────────
  const baseHyphenParams: Omit<AuctionSearchParams, "yongdo" | "page"> = {
    sido,
    gugun: sigunguCode,
    larea_min: landMin == null ? undefined : String(Math.round(landMin)),
    larea_max: landMax == null ? undefined : String(Math.round(landMax)),
    barea_min: bareaMin == null ? undefined : String(Math.round(bareaMin)),
    barea_max: bareaMax == null ? undefined : String(Math.round(bareaMax)),
    gamMin: toWon(gamMinMan),
    gamMax: toWon(gamMaxMan),
    lowMin: toWon(lowMinMan),
    lowMax: toWon(lowMaxMan),
    sday_s: bidStart ?? undefined,
    sday_e: bidEnd ?? undefined,
  };

  try {
    // ── yongdoCodes 분기 ────────────────────────────────
    // 빈 배열 = 전체 (yongdo 미지정 1회 호출)
    // 다중 = 코드별 병렬 sweep
    const yongdosToCall = yongdoCodes.length === 0 ? [undefined] : yongdoCodes;

    const sweeps = await Promise.all(
      yongdosToCall.map((yongdo) =>
        fetchAuctionVillageSweep({
          ...baseHyphenParams,
          ...(yongdo ? { yongdo } : {}),
        }),
      ),
    );

    // 첫 번째 비정상 status = 사용자 안내용 대표값. (인증/잔액/레이트리밋 등)
    const firstFail = sweeps.find((s) => s.apiStatus !== "ok");
    if (firstFail) {
      return NextResponse.json(
        {
          ok: true,
          apiStatus: firstFail.apiStatus as HyphenApiStatus,
          errCd: firstFail.errCd,
          errMsg: firstFail.errMsg,
          items: [] as AuctionListItem[],
          totalCountAll: 0,
          truncated: false,
          fetchedAt: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
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

    // ── enrich (PNU 19자리 + 좌표 + daysLeft + discountRatio + 사건명칭) ──
    const enriched = await enrichRawItems(rawItems);

    // ── 클라이언트 사이드 필터 ────────────────────────
    const filtered = enriched.filter((it) => {
      // 진행상태 (Hyphen 검색 파라미터엔 없음 — 응답 후 분류)
      if (progressStatus.length > 0 && !progressStatus.includes(it.진행상태)) {
        return false;
      }
      // 유찰횟수
      if (usbdMin != null && it.유찰수 < usbdMin) return false;
      if (usbdMax != null && it.유찰수 > usbdMax) return false;
      // 할인율 (% 단위 = discountRatio × 100)
      const discountPct = it.discountRatio * 100;
      if (discountMin != null && discountPct < discountMin) return false;
      if (discountMax != null && discountPct > discountMax) return false;
      // 읍면동 LIKE (대표소재지 OR 리스트지번주소)
      if (emdong) {
        const addr = `${it.대표소재지} ${it.리스트지번주소}`;
        if (!addr.includes(emdong)) return false;
      }
      return true;
    });

    return NextResponse.json(
      {
        ok: true,
        apiStatus: "ok" as HyphenApiStatus,
        errCd: "200",
        errMsg: "",
        items: filtered,
        totalCountAll,
        truncated,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[auction/search] error", e);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 },
    );
  }
}
