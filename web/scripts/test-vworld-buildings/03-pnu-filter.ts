export {};
/**
 * lt_c_spbd 에 fes:Filter PNU 1:1 매칭이 실제로 작동하는지 검증.
 *
 * 의뢰자 화면에서 직리 179 (PNU=4783035035101790000) 클릭 → 건물 0동 보고됨.
 * 검증 스크립트 02-fetch-buildings.ts 의 BBOX 호출에서는 11동 응답.
 * → fes:Filter 매칭이 lt_c_spbd 에 안 통할 가능성.
 *
 * 비교:
 *   A) fes:Filter pnu=...   (lib/vworld/buildings.ts 가 사용 중)
 *   B) BBOX + 클라이언트 PNU 필터  (fallback 후보)
 *
 * 실행:
 *   cd web && npx tsx --env-file=.env.local scripts/test-vworld-buildings/03-pnu-filter.ts
 */

const VWORLD_KEY = process.env.VWORLD_KEY ?? "";
const WFS_URL = "https://api.vworld.kr/req/wfs";
const REFERER = "https://sunlap.kr";

const PNU = "4783035035101790000"; // 직리 179
// 필지 BBOX (검증 스크립트 02 결과)
const BBOX = {
  minLng: 128.325256,
  minLat: 35.716381,
  maxLng: 128.326111,
  maxLat: 35.717116,
};

async function callA_fesFilter() {
  const filter =
    `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0">` +
    `<fes:PropertyIsEqualTo>` +
    `<fes:ValueReference>pnu</fes:ValueReference>` +
    `<fes:Literal>${PNU}</fes:Literal>` +
    `</fes:PropertyIsEqualTo>` +
    `</fes:Filter>`;
  const params = new URLSearchParams({
    key: VWORLD_KEY,
    domain: "sunlap.kr",
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typename: "lt_c_spbd",
    output: "application/json",
    srsName: "EPSG:4326",
    FILTER: filter,
  });
  const res = await fetch(`${WFS_URL}?${params}`, {
    headers: { Referer: REFERER },
  });
  const body = await res.text();
  console.log(`\n[A] fes:Filter pnu=${PNU}`);
  console.log(`  HTTP ${res.status}`);
  try {
    const json = JSON.parse(body);
    console.log(`  features=${json.features?.length ?? 0}`);
    if (json.features?.length) {
      for (const f of json.features) {
        console.log(`    pnu=${f.properties.pnu}  pk=${f.properties.pk}`);
      }
    } else {
      console.log(`  body: ${body.slice(0, 500)}`);
    }
  } catch {
    console.log(`  (non-JSON) body: ${body.slice(0, 500)}`);
  }
}

async function callA2_fesFilterUppercase() {
  // PNU 필드명이 대문자일 가능성 — 검증
  const filter =
    `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0">` +
    `<fes:PropertyIsEqualTo>` +
    `<fes:ValueReference>PNU</fes:ValueReference>` +
    `<fes:Literal>${PNU}</fes:Literal>` +
    `</fes:PropertyIsEqualTo>` +
    `</fes:Filter>`;
  const params = new URLSearchParams({
    key: VWORLD_KEY,
    domain: "sunlap.kr",
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typename: "lt_c_spbd",
    output: "application/json",
    srsName: "EPSG:4326",
    FILTER: filter,
  });
  const res = await fetch(`${WFS_URL}?${params}`, {
    headers: { Referer: REFERER },
  });
  const body = await res.text();
  console.log(`\n[A2] fes:Filter PNU=${PNU} (대문자 시도)`);
  console.log(`  HTTP ${res.status}`);
  try {
    const json = JSON.parse(body);
    console.log(`  features=${json.features?.length ?? 0}`);
  } catch {
    console.log(`  body: ${body.slice(0, 500)}`);
  }
}

async function callB_bboxThenFilter() {
  const pad = 0.0002;
  const params = new URLSearchParams({
    key: VWORLD_KEY,
    domain: "sunlap.kr",
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typename: "lt_c_spbd",
    output: "application/json",
    srsName: "EPSG:4326",
    bbox: [
      BBOX.minLng - pad,
      BBOX.minLat - pad,
      BBOX.maxLng + pad,
      BBOX.maxLat + pad,
    ].join(","),
    maxFeatures: "100",
  });
  const res = await fetch(`${WFS_URL}?${params}`, {
    headers: { Referer: REFERER },
  });
  const json = await res.json();
  const all = json.features ?? [];
  const matched = all.filter((f: { properties: { pnu: string } }) => f.properties.pnu === PNU);
  console.log(`\n[B] BBOX 호출 → 클라이언트 PNU 필터`);
  console.log(`  HTTP ${res.status}  total=${all.length}  matched(pnu=${PNU})=${matched.length}`);
  for (const f of matched) {
    console.log(`    pnu=${f.properties.pnu}  pk=${f.properties.pk}  buld_no=${f.properties.buld_no}`);
  }
}

async function main() {
  if (!VWORLD_KEY) {
    console.error("VWORLD_KEY 미설정");
    process.exit(1);
  }
  console.log(`PNU=${PNU} (직리 179)`);
  await callA_fesFilter();
  await callA2_fesFilterUppercase();
  await callB_bboxThenFilter();
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
