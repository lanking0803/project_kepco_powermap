export {};
/**
 * VWorld lt_c_spbd 호출 6~7초 병목 분석.
 *
 * 측정 항목:
 *   1. DNS lookup + TCP/TLS handshake 시간 (Node fetch undici 측정)
 *   2. fes:Filter PNU 매칭 vs BBOX 호출 시간 비교 — VWorld 인덱스 차이 검증
 *   3. 같은 PNU 두 번째 호출 — VWorld 서버 측 캐시 여부
 *   4. 연속 호출 일관성 (6~7초가 일정한지 변동인지)
 *   5. 다른 레이어와 비교 — lt_c_landinfobasemap (필지) 는 ~40ms 라고 함
 *
 * 실행:
 *   cd web && npx tsx --env-file=.env.local scripts/test-vworld-buildings/05-bottleneck.ts
 */

import { performance } from "node:perf_hooks";

const VWORLD_KEY = process.env.VWORLD_KEY ?? "";
const REFERER = "https://sunlap.kr";

const PNU = "4783035035101790000";
// 직리 179 BBOX (약 100m × 100m)
const BBOX = {
  minLng: 128.325056,
  minLat: 35.716181,
  maxLng: 128.326311,
  maxLat: 35.717316,
};

interface TimingResult {
  total_ms: number;
  status: number;
  body_bytes: number;
}

async function timed(url: string): Promise<TimingResult> {
  const t0 = performance.now();
  const res = await fetch(url, {
    headers: { Referer: REFERER },
  });
  const body = await res.text();
  const t1 = performance.now();
  return {
    total_ms: Math.round(t1 - t0),
    status: res.status,
    body_bytes: body.length,
  };
}

function buildFesUrl(typename: string, pnu: string): string {
  const filter =
    `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0">` +
    `<fes:PropertyIsEqualTo>` +
    `<fes:ValueReference>pnu</fes:ValueReference>` +
    `<fes:Literal>${pnu}</fes:Literal>` +
    `</fes:PropertyIsEqualTo>` +
    `</fes:Filter>`;
  const params = new URLSearchParams({
    key: VWORLD_KEY,
    domain: "sunlap.kr",
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typename,
    output: "application/json",
    srsName: "EPSG:4326",
    FILTER: filter,
  });
  return `https://api.vworld.kr/req/wfs?${params}`;
}

function buildBboxUrl(typename: string, b: typeof BBOX): string {
  const params = new URLSearchParams({
    key: VWORLD_KEY,
    domain: "sunlap.kr",
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typename,
    output: "application/json",
    srsName: "EPSG:4326",
    bbox: `${b.minLng},${b.minLat},${b.maxLng},${b.maxLat}`,
    maxFeatures: "100",
  });
  return `https://api.vworld.kr/req/wfs?${params}`;
}

async function main() {
  if (!VWORLD_KEY) {
    console.error("VWORLD_KEY 미설정");
    process.exit(1);
  }

  console.log("━━━ Test 1: 첫 호출 vs 같은 PNU 두 번째 (VWorld 서버 캐시?) ━━━");
  const fes1 = await timed(buildFesUrl("lt_c_spbd", PNU));
  console.log(`  fes:Filter [1차]   ${fes1.total_ms}ms  ${fes1.body_bytes}B  HTTP ${fes1.status}`);
  const fes2 = await timed(buildFesUrl("lt_c_spbd", PNU));
  console.log(`  fes:Filter [2차]   ${fes2.total_ms}ms  ${fes2.body_bytes}B  HTTP ${fes2.status}`);
  const fes3 = await timed(buildFesUrl("lt_c_spbd", PNU));
  console.log(`  fes:Filter [3차]   ${fes3.total_ms}ms  ${fes3.body_bytes}B  HTTP ${fes3.status}`);
  const cached = fes2.total_ms < fes1.total_ms * 0.5;
  console.log(`  → VWorld 서버 캐시: ${cached ? "있음 (2차가 50%+ 빠름)" : "없음 (시간 일정)"}`);

  console.log("\n━━━ Test 2: fes:Filter vs BBOX (인덱스 차이) ━━━");
  const fesA = await timed(buildFesUrl("lt_c_spbd", PNU));
  console.log(`  lt_c_spbd  fes:Filter PNU   ${fesA.total_ms}ms  ${fesA.body_bytes}B`);
  const bboxA = await timed(buildBboxUrl("lt_c_spbd", BBOX));
  console.log(`  lt_c_spbd  BBOX            ${bboxA.total_ms}ms  ${bboxA.body_bytes}B`);
  console.log(
    `  → BBOX 가 ${Math.round(((fesA.total_ms - bboxA.total_ms) / fesA.total_ms) * 100)}% 빠름`,
  );

  console.log("\n━━━ Test 3: 다른 레이어 비교 (필지 = lt_c_landinfobasemap) ━━━");
  const parcel = await timed(buildFesUrl("lt_c_landinfobasemap", PNU));
  console.log(`  lt_c_landinfobasemap  fes:Filter PNU   ${parcel.total_ms}ms  ${parcel.body_bytes}B`);
  console.log(
    `  → 필지 vs 건물 비율: 건물이 필지보다 ${Math.round(fesA.total_ms / parcel.total_ms)}배 느림`,
  );

  console.log("\n━━━ Test 4: 동일 호출 5회 연속 (변동성) ━━━");
  const samples: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const r = await timed(buildFesUrl("lt_c_spbd", PNU));
    samples.push(r.total_ms);
    console.log(`  ${i + 1}회: ${r.total_ms}ms`);
  }
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  console.log(`  평균 ${Math.round(avg)}ms  최소 ${min}ms  최대 ${max}ms  변동 ${max - min}ms`);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
