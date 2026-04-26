/**
 * GET /api/solar-permits/by-page?page=1&size=100
 *
 * Atomic endpoint — 전국 태양광 발전소 전기사업 허가 정보 페이지네이션 조회.
 *
 * ⚠️ 본 endpoint 는 "사용자 영업 화면용" 이 아닌 "API 살아있나 검증 + Phase 3 수집기 기반" 용도.
 *
 * 검증 결과 (2026-04-26): 외부 API 가 검색 필터 미지원 (LCTN_LOTNO_ADDR / LATITUDE 등 모두 NODATA).
 * 유일하게 작동하는 입력 = pageNo + numOfRows + type. 따라서:
 *   - 사용자가 PNU 클릭 → 즉석 검색 = 불가능 (이 endpoint 가 도와주지 못함)
 *   - 본 endpoint 는 페이지 1건씩만 받아옴
 *   - 진짜 사용자 검색 (by-pnu / near-point) = Phase 3 정식 작업에서 DB 적재 후 신설
 *
 * 외부 API: tn_pubr_public_solar_gen_flct_api (NIA, data.go.kr/15107742)
 * env: DATA_GO_KR_KEY
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSolarPermitsByPage } from "@/lib/solar-permit/by-page";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "data.go.kr tn_pubr_public_solar_gen_flct_api (NIA, 데이터ID 15107742)",
  cache: "no-store",
  auth: "user",
  inputs: [
    {
      name: "page",
      type: "number",
      required: false,
      sample: "1",
      description: "1-base 페이지 번호 (기본 1, 최대 122)",
    },
    {
      name: "size",
      type: "number",
      required: false,
      sample: "10",
      description: "페이지당 행 수 (기본 100, 최대 1000)",
    },
  ],
  outputSchema:
    "{ ok, page, size, totalCount, rows: SolarPermit[] }   // SolarPermit = 17 필드 정규화 (facilityName, lotnoAddr, lat, lng, capacityKw, operatingStatus 등)",
  externalDeps: ["solar-permit"],
  notes:
    "⚠️ 외부 API 가 검색 필터 미지원 → 페이지네이션만 가능. 사용자 영업 화면(이 PNU 근처 태양광)은 Phase 3 정식 작업에서 DB 적재 후 by-pnu/near-point 별도 신설 필요. 본 endpoint 는 (1) API 살아있는지 검증 (2) Phase 3 수집기 기반 코드 재활용 용도.",
};

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 },
    );
  }

  const sp = request.nextUrl.searchParams;
  const pageRaw = sp.get("page");
  const sizeRaw = sp.get("size");

  const page = pageRaw ? Number(pageRaw) : 1;
  const size = sizeRaw ? Number(sizeRaw) : 100;
  if (!Number.isFinite(page) || page < 1) {
    return NextResponse.json(
      { ok: false, error: "page 는 1 이상의 숫자여야 합니다." },
      { status: 400 },
    );
  }
  if (!Number.isFinite(size) || size < 1 || size > 1000) {
    return NextResponse.json(
      { ok: false, error: "size 는 1~1000 사이여야 합니다." },
      { status: 400 },
    );
  }

  try {
    const result = await getSolarPermitsByPage(page, size);
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[solar-permits/by-page] 호출 실패:", msg);
    const status = /환경변수/.test(msg) ? 500 : 502;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
