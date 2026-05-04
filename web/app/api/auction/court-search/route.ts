/**
 * GET /api/auction/court-search
 *
 * Atomic endpoint — 법원경매정보재공 직접 호출 + bjd_master JOIN.
 *
 * 흐름:
 *   1. sigunguCode (5자리 BJD prefix) → adongSdCd (2) + adongSggCd (3) 분리
 *   2. fetchCourtList (응답 후 500ms 직렬화 + WAF 재시도)
 *   3. courtToAuctionItems → AuctionListItem 정규화 (어댑터, hyphen 과 SSOT 통일)
 *
 * 설계 원칙 (의뢰자 합의 2026-05-04):
 *   - 어댑터 패턴 — 출력 타입은 AuctionListItem (hyphen 과 동일)
 *   - 채널 swap 시 route.ts 한 줄만 변경
 *   - DB 적재 X (실시간 passthrough)
 *
 * 사용처:
 *   - 향후 AuctionSearchPanel 의 채널 토글 (운영 모드에서 hyphen ↔ court 선택)
 *   - 현재는 검증/관리자 라이브 테스터용
 */

import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { courtToAuctionItems } from "@/lib/court-auction/adapter";
import { fetchCourtList } from "@/lib/court-auction/fetch";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source:
    "법원경매정보재공 직접 호출 (/pgj/pgjsearch/searchControllerMain.on) + bjd_master JOIN. 인증/세션 불필요. 응답 후 500ms 직렬화 + WAF 재시도.",
  cache: "no-store",
  auth: "user",
  inputs: [
    {
      name: "sigunguCode",
      type: "string",
      required: true,
      sample: "46130",
      description:
        "행안부 5자리 BJD prefix. 자동 분리: [0:2]=adongSdCd, [2:5]=adongSggCd",
    },
    {
      name: "sidoName",
      type: "string",
      required: false,
      sample: "전라남도",
      description: "시도 한글명 — bjd_master sep_1 매칭으로 동명이리 충돌 방지",
    },
    {
      name: "pageNo",
      type: "number",
      required: false,
      sample: "1",
      description: "페이지 번호 (1-base, 기본 1)",
    },
    {
      name: "pageSize",
      type: "number",
      required: false,
      sample: "50",
      description: "페이지 크기. 10/50 만 허용 (60+ 거부). 기본 50.",
    },
    {
      name: "orderBy",
      type: "string",
      required: false,
      sample: "",
      description:
        "정렬 — 빈값 또는 'order by dspslDxdyYmd asc' (매각기일 오름차순)",
    },
    {
      name: "bfPageNo",
      type: "number",
      required: false,
      sample: "",
      description: "이전 페이지 번호 (2p+ 호출 시 1p 응답값 echo)",
    },
    {
      name: "totalCnt",
      type: "string",
      required: false,
      sample: "",
      description: "1p 응답의 totalCnt (2p+ 호출 시 echo)",
    },
    {
      name: "groupTotalCount",
      type: "number",
      required: false,
      sample: "",
      description: "1p 응답의 groupTotalCount (2p+ 호출 시 echo)",
    },
  ],
  outputSchema:
    "{ ok: true, apiStatus, items: AuctionListItem[], totalCnt, groupTotalCount, pageNo, pageSize, hasMore, fetchedAt }",
  externalDeps: ["court-auction-direct", "supabase"],
  notes:
    "법원경매 사이트 직접 호출 채널 (hyphen 대비 응답 70배 가벼움 — 140KB/50건). 인증/세션/쿠키 0. WAF 회피용 모듈 전역 직렬화 500ms + 차단 키워드 감지 시 800ms+jitter 1회 재시도. 출력은 hyphen 과 같은 AuctionListItem 타입 — 채널 swap 시 route 만 교체. 페이지네이션 echo: 2페이지 이상 호출 시 bfPageNo/totalCnt/groupTotalCount 를 1p 응답에서 가져와 전달 필요.",
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

  // sigunguCode (5자리 BJD prefix) → adongSdCd + adongSggCd 분리
  const sigunguCode = (sp.get("sigunguCode") ?? "").trim();
  if (!/^\d{5}$/.test(sigunguCode)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "sigunguCode 는 5자리 BJD prefix 입니다. (예: 46130 = 전남 여수시)",
      },
      { status: 400 },
    );
  }
  const sdCd = sigunguCode.slice(0, 2);
  const sggCd = sigunguCode.slice(2, 5);

  // sidoName — 어댑터 단계 동명이리 방지용 (옵션)
  const sidoName = (sp.get("sidoName") ?? "").trim() || null;

  // 페이지네이션
  const pageNo = clampInt(numOrZero(sp.get("pageNo")) || 1, 1, 9999);
  const pageSizeRaw = numOrZero(sp.get("pageSize")) || 50;
  // 50 외 값은 50 으로 강제 (서버 거부 회피)
  const pageSize = pageSizeRaw === 10 ? 10 : 50;

  const orderBy = sp.get("orderBy") ?? "";

  // 2p+ 호출용 echo 파라미터 (옵션)
  const bfPageNoRaw = sp.get("bfPageNo");
  const bfPageNo: number | "" = bfPageNoRaw ? Number(bfPageNoRaw) : "";
  const totalCntEcho = sp.get("totalCnt") ?? "";
  const groupTotalCountRaw = sp.get("groupTotalCount");
  const groupTotalCount: number | "" = groupTotalCountRaw
    ? Number(groupTotalCountRaw)
    : "";

  // startRowNo 자동 계산 (2p+ 일 때)
  const startRowNo: number | "" =
    pageNo > 1 ? (pageNo - 1) * pageSize + 1 : "";

  // totalYn — 1p="Y", 2p+="N"
  const totalYn: "Y" | "N" = pageNo === 1 ? "Y" : "N";

  try {
    const result = await fetchCourtList({
      sdCd,
      sggCd,
      pageNo,
      pageSize,
      orderBy,
      bfPageNo,
      startRowNo,
      totalCnt: totalCntEcho,
      totalYn,
      groupTotalCount,
    });

    if (result.apiStatus === "blocked" || result.apiStatus === "unavailable") {
      return NextResponse.json(
        {
          ok: true,
          apiStatus: result.apiStatus,
          errMsg: result.errMsg ?? "",
          items: [],
          totalCnt: 0,
          groupTotalCount: 0,
          pageNo,
          pageSize,
          hasMore: false,
          fetchedAt: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // 어댑터 — Court raw → AuctionListItem
    const items = await courtToAuctionItems(result.items, sidoName);

    return NextResponse.json(
      {
        ok: true,
        apiStatus: result.apiStatus,
        items,
        totalCnt: result.totalCnt,
        groupTotalCount: result.groupTotalCount,
        pageNo: result.pageNo,
        pageSize: result.pageSize,
        hasMore: result.hasMore,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[auction/court-search] error", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

function numOrZero(v: string | null): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(n)));
}
