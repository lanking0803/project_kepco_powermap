/**
 * GET /api/solar-permits/by-pnu?pnu=...
 *
 * 매물 PNU 19자리 → 같은 필지 + 같은 동/리 태양광 발전소 현황 + 마커 좌표.
 *
 * 응답 (성공):
 *   {
 *     ok, pnu, bjd_code,
 *     same_pnu: SolarPermitRow[],                                                   // 정확 매칭
 *     same_dong: {
 *       count, total_kw,
 *       rows: [{ pnu, jibun, facility_name, capacity_kw, operating_status, permit_date, lat, lng }]
 *     },                                                                            // 동/리 집계 + 전체 목록
 *     same_dong_markers: [{ lat, lng, pnu, jibun, name, kw }]                       // 좌표 보유 행만
 *   }
 *
 * 데이터 출처: Supabase Storage 'solar-permits' bucket (Public, BJD 별 JSON).
 *   - 매월 1일 09:00 KST GH Actions cron 으로 워커가 갱신 (crawler/solar_permits.py)
 *   - Public bucket → Supabase Smart CDN (Fastly) 가 자동 분산
 *   - 외부 API 가 좌표 ~47% 만 제공 → same_dong_markers.length 가 same_dong.count 보다 작을 수 있음 (정상)
 *
 * 캐시 4겹:
 *   ① 클라이언트 페이지 라이프타임 (lib/api/solar-permits.ts Map)
 *   ② 브라우저 (max-age=120)
 *   ③ Vercel CDN (s-maxage=600)
 *   ④ Supabase Smart CDN (Fastly)
 *
 * 저장소 변경 이력:
 *   v1: solar_permits 테이블 (DB 2쿼리)
 *   v2: Storage bucket Public raw fetch + JS 가공
 *   v2.1: same_dong_markers 추가 (지도 마커용, 동일 BJD JSON 재사용 — 추가 호출 0)
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

const BUCKET = "solar-permits";
const SAME_PNU_LIMIT = 50;

interface SolarRow {
  pnu: string;
  facility_name: string;
  capacity_kw: number | null;
  operating_status: string | null;
  permit_date: string | null;
  lat: number | null;
  lng: number | null;
}

interface SolarMarker {
  lat: number;
  lng: number;
  pnu: string;
  jibun: string;
  name: string;
  kw: number | null;
}

/** PNU 19자리 → "821" / "821-3" / "산 87-4" 형태의 사람이 읽을 지번 라벨. */
function pnuToJibun(pnu: string): string {
  const isSan = pnu[10] === "2";
  const main = parseInt(pnu.slice(11, 15), 10);
  const sub = parseInt(pnu.slice(15, 19), 10);
  const base = sub > 0 ? `${main}-${sub}` : `${main}`;
  return isSan ? `산 ${base}` : base;
}

export const meta: EndpointMeta = {
  source:
    "Storage (solar-permits bucket, public) — data.go.kr NIA 15107742 가 출처, 매월 1일 GH cron 으로 BJD 별 JSON 적재",
  cache: "private, s-maxage=600, max-age=120",
  auth: "user",
  inputs: [
    {
      name: "pnu",
      type: "string",
      required: true,
      sample: "4684039022012340005",
      description: "매물 PNU 19자리 숫자 (시도2+시군구3+읍면동3+산구분1+본번4+부번4)",
    },
  ],
  outputSchema:
    "{ ok, pnu, bjd_code, same_pnu, same_dong: { count, total_kw, rows: SameDongRow[] }, same_dong_markers: { lat, lng, pnu, jibun, name, kw }[] }",
  externalDeps: [],
  notes:
    "Public bucket → Smart CDN (Fastly) 자동. BJD JSON 미존재 = 그 동에 발전소 0건 (정상). same_dong_markers 는 외부 API 좌표 결측 (~53%) 제외한 행만 — count 보다 작은 게 정상.",
};

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
      { ok: false, error: "pnu 는 19자리 숫자여야 합니다." },
      { status: 400 },
    );
  }
  const bjd_code = pnu.slice(0, 10);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    return NextResponse.json(
      { ok: false, error: "NEXT_PUBLIC_SUPABASE_URL 환경변수 누락." },
      { status: 500 },
    );
  }

  const objectUrl = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${bjd_code}.json`;

  const res = await fetch(objectUrl);

  // Supabase Storage 는 객체 미존재 시 HTTP 400 + body 의 statusCode "404" 로 응답.
  // 즉 res.status 만으론 not-found 판별 불가 — body 파싱 후 분기.
  if (!res.ok) {
    let errBody: { statusCode?: string; error?: string; message?: string } | null =
      null;
    try {
      errBody = await res.json();
    } catch {
      // JSON 아닌 응답 — 일반 에러로 처리
    }
    if (errBody?.statusCode === "404" || errBody?.error === "not_found") {
      // 그 BJD 에 발전소 0건 (정상 케이스)
      return emptyResponse(pnu, bjd_code);
    }
    return NextResponse.json(
      {
        ok: false,
        error: `Storage 응답 ${res.status}${
          errBody?.message ? `: ${errBody.message}` : ""
        }`,
      },
      { status: 502 },
    );
  }

  let rows: SolarRow[];
  try {
    rows = (await res.json()) as SolarRow[];
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `JSON 파싱 실패: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  // same_pnu — 정확히 일치하는 PNU, capacity_kw 내림차순, 50건 제한 (v1 과 동일)
  const samePnu = rows
    .filter((r) => r.pnu === pnu)
    .sort((a, b) => (b.capacity_kw ?? 0) - (a.capacity_kw ?? 0))
    .slice(0, SAME_PNU_LIMIT)
    .map((r) => ({
      facility_name: r.facility_name,
      capacity_kw: r.capacity_kw,
      operating_status: r.operating_status,
      permit_date: r.permit_date,
      lat: r.lat,
      lng: r.lng,
    }));

  // same_dong — 그 BJD 전체 합산 + 목록 (용량 내림차순)
  const sameDongCount = rows.length;
  const sameDongTotal = rows.reduce(
    (s, r) => s + (Number(r.capacity_kw) || 0),
    0,
  );
  const sameDongRows = [...rows]
    .sort((a, b) => (b.capacity_kw ?? 0) - (a.capacity_kw ?? 0))
    .map((r) => ({
      pnu: r.pnu,
      jibun: pnuToJibun(r.pnu),
      facility_name: r.facility_name,
      capacity_kw: r.capacity_kw,
      operating_status: r.operating_status,
      permit_date: r.permit_date,
      lat: r.lat,
      lng: r.lng,
    }));

  // same_dong_markers — 좌표 보유 행만 (외부 API 가 동네별로 0~100% 편차)
  const sameDongMarkers: SolarMarker[] = sameDongRows
    .filter((r) => r.lat != null && r.lng != null)
    .map((r) => ({
      lat: r.lat as number,
      lng: r.lng as number,
      pnu: r.pnu,
      jibun: r.jibun,
      name: r.facility_name,
      kw: r.capacity_kw,
    }));

  return NextResponse.json(
    {
      ok: true,
      pnu,
      bjd_code,
      same_pnu: samePnu,
      same_dong: {
        count: sameDongCount,
        total_kw: Math.round(sameDongTotal),
        rows: sameDongRows,
      },
      same_dong_markers: sameDongMarkers,
    },
    {
      headers: { "Cache-Control": "private, s-maxage=600, max-age=120" },
    },
  );
}

function emptyResponse(pnu: string, bjd_code: string) {
  return NextResponse.json(
    {
      ok: true,
      pnu,
      bjd_code,
      same_pnu: [],
      same_dong: { count: 0, total_kw: 0, rows: [] },
      same_dong_markers: [],
    },
    {
      headers: { "Cache-Control": "private, s-maxage=600, max-age=120" },
    },
  );
}
