/**
 * GET /api/auction/court-detail
 *
 * Atomic endpoint — 법원경매정보재공 사건 상세 직접 호출.
 *
 * 흐름:
 *   1. cortOfcCd + csNo 입력 (목록 응답의 boCd + saNo 조합 그대로)
 *   2. fetchCourtDetail (응답 후 500ms 직렬화 + WAF 재시도)
 *   3. raw 12개 섹션을 그대로 응답 (사건기본/물건/목록/기일/당사자/배당/항고/관련/중복)
 *
 * 어댑터 미적용 이유:
 *   - 상세는 12개 섹션 다중 데이터 → 단일 AuctionDetail 타입으로 자르면 정보 손실
 *   - UI 측에서 필요한 섹션만 골라 사용 (현재 ParcelInfoPanel [경매] 탭은 hyphen 의 단일 객체 사용)
 *   - 향후 UI 통합 시 어댑터 추가 (현재는 raw passthrough)
 */

import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { fetchCourtDetail } from "@/lib/court-auction/fetch";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source:
    "법원경매정보재공 사건 상세 (/pgj/pgj15A/selectAuctnCsSrchRslt.on). 인증 불필요.",
  cache: "no-store",
  auth: "user",
  inputs: [
    {
      name: "cortOfcCd",
      type: "string",
      required: true,
      sample: "B000513",
      description:
        "법원 코드 (목록 응답의 boCd 또는 cortOfcCd). 예: B000513=순천지원",
    },
    {
      name: "csNo",
      type: "string",
      required: true,
      sample: "20210130004007",
      description:
        "사건번호 raw 14자리 (목록 응답의 saNo). 사용자 형식 '2021타경4007' 이 아님",
    },
  ],
  outputSchema:
    "{ ok: true, apiStatus, data: { dma_csBasInf, dlt_dspslGdsDspslObjctLst[], dlt_rletCsDspslObjctLst[], dlt_rletCsGdsDtsDxdyInf[], dlt_rletCsIntrpsLst[], dlt_dstrtDemnLstprdDts[], dlt_csApalRaplDts[], dlt_rletReltCsLst[], dlt_dpcnMrgTrnscsCsRlet[], dlt_rletCsSugtExclBldLst[] }, fetchedAt }",
  externalDeps: ["court-auction-direct"],
  notes:
    "사건 상세 12개 섹션 raw 그대로 응답. 사건기본/물건/목록/기일/당사자/배당요구/항고/관련사건/중복병합/제시외건물. 응답 약 17KB. 화면 매핑: dma_csBasInf=사건기본내역, dlt_dspslGdsDspslObjctLst=물건내역, dlt_rletCsDspslObjctLst=목록내역, dlt_rletCsGdsDtsDxdyInf=기일내역, dlt_rletCsIntrpsLst=당사자내역. 현황조사서/감정평가서 PDF 바로가기는 별도 endpoint (현재 미구현 — 의뢰자 결정: 영업 시작 단계엔 불필요).",
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
  const cortOfcCd = (sp.get("cortOfcCd") ?? "").trim();
  const csNo = (sp.get("csNo") ?? "").trim();

  if (!/^B\d{6}$/.test(cortOfcCd)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "cortOfcCd 는 'B' + 6자리 숫자 형식입니다. (예: B000513=순천지원)",
      },
      { status: 400 },
    );
  }
  if (!/^\d{14}$/.test(csNo)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "csNo 는 14자리 숫자입니다. (목록 응답의 saNo. 예: 20210130004007)",
      },
      { status: 400 },
    );
  }

  try {
    const result = await fetchCourtDetail({ cortOfcCd, csNo });

    if (result.apiStatus !== "ok") {
      return NextResponse.json(
        {
          ok: true,
          apiStatus: result.apiStatus,
          errMsg: result.errMsg ?? "",
          data: null,
          fetchedAt: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        apiStatus: "ok",
        data: result.data,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[auction/court-detail] error", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
