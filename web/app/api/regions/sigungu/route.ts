/**
 * GET /api/regions/sigungu
 *
 * Atomic endpoint — 한국 전국 시군구 약 250건 (시도/시군구/bjd_code 5자리).
 *
 * 사용처:
 *   - 모든 모드의 시도/시군구 종속 드롭다운 (취락지구/공매/경매/시설 공통)
 *
 * 응답:
 *   { ok: true, count: 250, items: [{ sido, si, gu, code }, ...] }
 *
 * 캐시:
 *   - 30일 CDN (s-maxage=2592000) + SWR 1일.
 *     행정구역 개편 빈도 ≈ 5년에 1건이라 30일 캐시 안전.
 *   - 클라이언트는 lib/api/regions.ts 가 모듈 scope 캐시로 한 번 더 합침.
 *     실제 Supabase 도달 호출은 사실상 30일에 1회 (CDN miss 시).
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listSigungus } from "@/lib/regions/sigungu";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source: "Supabase bjd_master (행안부 법정동 코드, 월 1회 갱신).",
  cache: "public, s-maxage=2592000, stale-while-revalidate=86400",
  auth: "user",
  inputs: [],
  outputSchema:
    "{ ok, count, items: Array<{ sido: string, si: string|null, gu: string|null, label: string, code: string }> }",
  externalDeps: [],
  notes:
    "약 250건 — 한국 전체 시군구. bjd_code 끝 5자리가 00000 인 시군구 대표 행만. " +
    "label = sep_2 + sep_3 trim. 일반시 자체(여수시 등)는 si=시명, gu=null. " +
    "30일 CDN 캐시 + 클라이언트 모듈 캐시 병행.",
};

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  const items = await listSigungus();
  return NextResponse.json(
    { ok: true, count: items.length, items },
    {
      headers: {
        "Cache-Control":
          "public, s-maxage=2592000, stale-while-revalidate=86400",
      },
    }
  );
}
