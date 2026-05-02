/**
 * GET /api/auction/detail?productId=<경매번호>
 *
 * Atomic endpoint — 단건 경매사건 상세 (사진/감정평가서/임차인/등기부/명도비/예상배당 등 풍부 정보).
 *
 * 흐름:
 *   1. productId 검증 (숫자)
 *   2. Hyphen /au0147001254 호출
 *   3. 응답 그대로 반환 (raw 필드명 한글 그대로 — 의뢰자 결정: 가공 X)
 *
 * 사용처:
 *   - AuctionTab 매물 카드의 "상세 펼치기" 버튼 → 클라이언트 lazy fetch
 *   - 캐시: 클라이언트 모듈 캐시 (productId 단위, lib/hyphen/detail.ts)
 *
 * 외부 호출: 1번. 비즈머니 부담 우려 적음.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { fetchAuctionDetail } from "@/lib/hyphen/client";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "Hyphen 경매다 /au0147001254 (경매사건상세보기)",
  cache: "no-store",
  auth: "user",
  inputs: [
    {
      name: "productId",
      type: "string",
      required: true,
      sample: "1054811",
      description:
        "경매번호 (= 진행물건검색 응답의 '경매번호' 필드. 사건번호코드 X)",
    },
  ],
  outputSchema:
    "{ ok: true, productId, apiStatus, errCd, errMsg, detail: AuctionRawDetailItem | null, fetchedAt }",
  externalDeps: ["hyphen"],
  notes: "사건번호코드와 product_id 는 다름 — 검색 응답의 '경매번호' 필드를 productId 로 전달해야 함. 응답에 이미지/감정평가서/임차인/등기부/명도비/예상배당/인근물건 등 45개 필드 포함.",
};

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 },
    );
  }

  const productId = (req.nextUrl.searchParams.get("productId") ?? "").trim();
  if (!/^\d+$/.test(productId)) {
    return NextResponse.json(
      { ok: false, error: "productId 형식 오류 (숫자 필요)" },
      { status: 400 },
    );
  }

  try {
    const res = await fetchAuctionDetail(productId);
    return NextResponse.json(
      {
        ok: true,
        productId,
        apiStatus: res.apiStatus,
        errCd: res.errCd,
        errMsg: res.errMsg,
        detail: res.detail,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[auction/detail] error", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
