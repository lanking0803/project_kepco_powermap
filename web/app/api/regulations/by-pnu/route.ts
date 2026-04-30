/**
 * GET /api/regulations/by-pnu?pnu=...
 *
 * Atomic endpoint — PNU → 광역(시도) + 기초(시군구) 도시계획 조례 목록.
 *
 * 흐름:
 *   1. PNU → VWorld 필지 조회 → ctp_nm + sig_nm 추출
 *   2. 행정구역 분류 (단층광역/시/군/자치구) → 광역 + 기초 검색 query 결정
 *   3. 법제처 API 2회 호출 (광역 + 기초, 단층광역은 1회)
 *   4. 응답 필터: 지자체기관명 매칭 (광역 = "충청남도", 기초 = "충청남도 부여군")
 *   5. wide / local 분리 반환
 *
 * 사용처:
 *   - 견적 모드 사이드바 ① 부지 확인 카드 아래 "관련 조례" 박스 (서니로직 모방)
 *
 * 응답 (성공):
 *   { ok: true, pnu, region: { ctp_nm, sig_nm, sig_kind }, wide: [...], local: [...] }
 * 응답 (필지 없음):
 *   { ok: true, pnu, region: null, wide: [], local: [] }
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getParcelByPnu } from "@/lib/vworld/parcel";
import { searchOrdinancesByQuery } from "@/lib/regulations/law-api";
import { classifyRegionForRegulation } from "@/lib/regulations/region";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "법제처 OPEN API (자치법규 검색, 광역+기초 2회 호출)",
  cache: "private, s-maxage=86400, max-age=3600",
  auth: "user",
  inputs: [
    {
      name: "pnu",
      type: "string",
      required: true,
      sample: "4476042028100290004",
      description:
        "PNU 19자리 숫자. 부여군 장암면 지토리 29-4 (광역도+군 케이스).",
    },
  ],
  outputSchema:
    "{ ok, pnu, region: { ctp_nm, sig_nm, sig_kind } | null, wide: LawOrdinance[], local: LawOrdinance[] }",
  externalDeps: ["vworld", "law-go-kr"],
  notes: `1차 ➕ 조례 옵션 (30만) 구현. 서니로직 UI 모방. 견적 모드 사이드바 노출.

**행정구역 분기**:
- 광역도 + 군 (예: 부여군) → 광역 "도시계획" + 기초 "군계획"
- 광역도 + 시 (예: 수원시) → 광역 "도시계획" + 기초 "도시계획"
- 광역시 + 자치구 (예: 강남구) → 광역 "도시계획" + 기초 "도시계획"
- 단층 (세종/제주) → 광역만 검색, 기초 X

**검색 한계**:
- 법제처는 자치법규명(제목) 매칭만 가능 — 본문/지자체 필터 무시됨
- 일부 시·군은 "도시계획 조례" 명칭이 없어 결과 0건 가능 (정상)

**캐시**: query 단위 모듈 scope Map 24h. 서로 다른 PNU 라도 같은 시·군이면 캐시 히트.`,
};

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 },
    );
  }

  const pnu = request.nextUrl.searchParams.get("pnu")?.trim() ?? "";
  if (!/^\d{19}$/.test(pnu)) {
    return NextResponse.json(
      { ok: false, error: "pnu 는 19자리 숫자여야 합니다." },
      { status: 400 },
    );
  }

  // 1) VWorld 필지 → 시도/시군 명칭
  const parcel = await getParcelByPnu(pnu);
  if (!parcel) {
    return NextResponse.json(
      { ok: true, pnu, region: null, wide: [], local: [] },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  }

  const region = classifyRegionForRegulation(
    parcel.jibun.ctp_nm,
    parcel.jibun.sig_nm,
  );

  // 2) 광역 + 기초 검색 (병렬)
  const [wideRaw, localRaw] = await Promise.all([
    searchOrdinancesByQuery(region.wideQuery),
    region.localQuery
      ? searchOrdinancesByQuery(region.localQuery)
      : Promise.resolve([]),
  ]);

  // 3) 지자체기관명 매칭 필터
  const wide = wideRaw.filter((row) => row.organ === region.wideOrganMatch);
  const local = region.localOrganMatch
    ? localRaw.filter((row) => row.organ === region.localOrganMatch)
    : [];

  return NextResponse.json(
    {
      ok: true,
      pnu,
      region: {
        ctp_nm: region.ctp_nm,
        sig_nm: region.sig_nm,
        sig_kind: region.sig_kind,
      },
      wide,
      local,
    },
    {
      headers: { "Cache-Control": "private, s-maxage=86400, max-age=3600" },
    },
  );
}
