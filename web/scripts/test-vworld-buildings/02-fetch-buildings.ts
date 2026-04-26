export {};
/**
 * lt_c_spbd (도로명주소건물) 실측 검증.
 *
 * 검증 항목:
 *   1. BBOX 호출로 건물 폴리곤 응답 받는가
 *   2. 응답 properties 스키마 (어떤 키 / pnu 매칭 가능한가)
 *   3. geometry 타입 / 좌표 개수 / 면적 (㎡)
 *   4. 동일 필지(LX) 안에서 건물 N동 분리되는가 (다중 동 사례)
 *   5. 카카오맵 그릴 수 있는 EPSG:4326 좌표인가 (lng/lat 범위 sanity)
 *
 * 실행:
 *   cd web && npx tsx --env-file=.env.local scripts/test-vworld-buildings/02-fetch-buildings.ts
 */

import area from "@turf/area";
import type { Feature, MultiPolygon, Polygon } from "geojson";

const VWORLD_KEY = process.env.VWORLD_KEY ?? "";
const WFS_URL = "https://api.vworld.kr/req/wfs";
const REFERER = "https://sunlap.kr";
const TIMEOUT_MS = 8000;

interface TestCase {
  label: string;
  /** 필지 PNU (LX 로 먼저 필지 폴리곤 → BBOX 추출 → 건물 검색) */
  pnu?: string;
  /** 직접 BBOX (도시 정중앙 등) */
  bbox?: { minLng: number; minLat: number; maxLng: number; maxLat: number };
}

const CASES: TestCase[] = [
  {
    label: "경북 고령군 개진면 직리 179 (공장용지)",
    pnu: "4783035035101790000",
  },
  {
    label: "전남 구례군 구례읍 봉남리 6-2 (예시 PDF 부지)",
    pnu: "4673025025100060002",
  },
  {
    label: "서울시청 주변 (도시 고밀도, 200m × 200m)",
    bbox: {
      minLng: 126.9774,
      minLat: 37.5658,
      maxLng: 126.9794,
      maxLat: 37.5678,
    },
  },
];

async function callWfs(params: URLSearchParams): Promise<{ ok: boolean; status?: number; data?: unknown; body?: string; error?: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${WFS_URL}?${params.toString()}`, {
      signal: ctl.signal,
      headers: { Referer: REFERER },
    });
    if (!res.ok) return { ok: false, status: res.status, body: (await res.text()).slice(0, 300) };
    const text = await res.text();
    try {
      return { ok: true, data: JSON.parse(text) };
    } catch {
      return { ok: false, error: "JSON parse 실패", body: text.slice(0, 300) };
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}

interface Feat {
  type: "Feature";
  geometry: Polygon | MultiPolygon;
  properties: Record<string, string | number | null>;
}

interface Fc {
  type: "FeatureCollection";
  features: Feat[];
}

async function fetchParcelBbox(pnu: string): Promise<{ minLng: number; minLat: number; maxLng: number; maxLat: number; addr: string } | null> {
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
    typename: "lt_c_landinfobasemap",
    output: "application/json",
    srsName: "EPSG:4326",
    FILTER: filter,
  });
  const r = await callWfs(params);
  if (!r.ok) {
    console.log(`    ⚠️ 필지 조회 실패 (${pnu}): ${r.status ?? r.error}`);
    return null;
  }
  const fc = r.data as Fc;
  const f = fc.features?.[0];
  if (!f) {
    console.log(`    ⚠️ PNU ${pnu} 필지 응답 0건 — 봉남리 6-2 PNU 가 다를 수 있음`);
    return null;
  }
  const coords = f.geometry.type === "Polygon"
    ? (f.geometry.coordinates[0] as number[][])
    : ((f.geometry.coordinates[0] as number[][][])[0] as number[][]);
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  const p = f.properties;
  const addr = `${p.sido_nm} ${p.sgg_nm} ${p.emd_nm}${p.ri_nm ? " " + p.ri_nm : ""} ${p.jibun}`;
  return {
    minLng: Math.min(...lngs),
    minLat: Math.min(...lats),
    maxLng: Math.max(...lngs),
    maxLat: Math.max(...lats),
    addr,
  };
}

async function fetchBuildings(bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number }): Promise<Fc | null> {
  // 약간 padding
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
      bbox.minLng - pad,
      bbox.minLat - pad,
      bbox.maxLng + pad,
      bbox.maxLat + pad,
    ].join(","),
    maxFeatures: "50",
  });
  const r = await callWfs(params);
  if (!r.ok) {
    console.log(`    ❌ lt_c_spbd 호출 실패: ${r.status ?? r.error}`);
    if (r.body) console.log(`       body: ${r.body}`);
    return null;
  }
  return r.data as Fc;
}

function summarizeBuilding(f: Feat, idx: number) {
  const props = f.properties;
  const turfFeat: Feature<Polygon | MultiPolygon> = {
    type: "Feature",
    properties: {},
    geometry: f.geometry,
  };
  const m2 = Math.round(area(turfFeat));
  const pyeong = (m2 / 3.305785).toFixed(1);

  const coords =
    f.geometry.type === "Polygon"
      ? (f.geometry.coordinates[0] as number[][])
      : ((f.geometry.coordinates[0] as number[][][])[0] as number[][]);
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  const cLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;

  return {
    idx,
    geomType: f.geometry.type,
    coordCount: coords.length,
    m2,
    pyeong,
    cLng,
    cLat,
    propsKeys: Object.keys(props).sort(),
    pnu: (props.pnu ?? props.PNU ?? null) as string | null,
    bul_man_no: (props.bul_man_no ?? null) as string | null,
    bul_no: (props.bul_no ?? null) as string | null,
    rn: (props.rn ?? props.road_nm ?? null) as string | null,
    bld_nm: (props.bld_nm ?? props.bldnm ?? null) as string | null,
    sample: props,
  };
}

async function main() {
  if (!VWORLD_KEY) {
    console.error("❌ VWORLD_KEY 미설정");
    process.exit(1);
  }
  console.log(`VWORLD_KEY ${VWORLD_KEY.slice(0, 6)}…\n`);

  for (const c of CASES) {
    console.log("━".repeat(80));
    console.log(`▶ ${c.label}`);

    let bbox = c.bbox;
    if (c.pnu) {
      console.log(`  필지 BBOX 추출 (PNU=${c.pnu})…`);
      const pbbox = await fetchParcelBbox(c.pnu);
      if (!pbbox) continue;
      console.log(`    addr: ${pbbox.addr}`);
      console.log(
        `    필지 bbox: lng=[${pbbox.minLng.toFixed(6)}, ${pbbox.maxLng.toFixed(6)}]  lat=[${pbbox.minLat.toFixed(6)}, ${pbbox.maxLat.toFixed(6)}]`,
      );
      bbox = pbbox;
    }
    if (!bbox) continue;

    console.log("  lt_c_spbd 건물 폴리곤 호출…");
    const fc = await fetchBuildings(bbox);
    if (!fc) continue;
    console.log(`  ✅ features=${fc.features.length}`);

    if (fc.features.length === 0) {
      console.log("    (해당 BBOX 안에 건물 0동 — 빈 땅이거나 미등록)");
      continue;
    }

    // 첫 번째 건물 properties 전체 덤프 (스키마 확인용)
    console.log("\n  [샘플 1동 properties 전체]");
    console.log("    " + JSON.stringify(fc.features[0].properties, null, 2).replace(/\n/g, "\n    "));

    console.log("\n  [건물 요약]");
    fc.features.forEach((f, i) => {
      const s = summarizeBuilding(f, i + 1);
      console.log(
        `    ${String(s.idx).padStart(2)}. ${s.geomType}  coords=${s.coordCount}  ${s.m2}㎡ (${s.pyeong}평)  center=(${s.cLng.toFixed(6)},${s.cLat.toFixed(6)})  pnu=${s.pnu ?? "-"}  bld=${s.bld_nm ?? "-"}  rn=${s.rn ?? "-"}`,
      );
    });

    // EPSG:4326 sanity (한국 영역: lng 124~132, lat 33~39)
    const allLngs: number[] = [];
    const allLats: number[] = [];
    for (const f of fc.features) {
      const coords =
        f.geometry.type === "Polygon"
          ? (f.geometry.coordinates[0] as number[][])
          : ((f.geometry.coordinates[0] as number[][][])[0] as number[][]);
      for (const [lng, lat] of coords) {
        allLngs.push(lng);
        allLats.push(lat);
      }
    }
    const lngOk = Math.min(...allLngs) >= 124 && Math.max(...allLngs) <= 132;
    const latOk = Math.min(...allLats) >= 33 && Math.max(...allLats) <= 39;
    console.log(
      `\n  좌표 sanity: lng ${lngOk ? "✅" : "❌"} [${Math.min(...allLngs).toFixed(4)}, ${Math.max(...allLngs).toFixed(4)}]  lat ${latOk ? "✅" : "❌"} [${Math.min(...allLats).toFixed(4)}, ${Math.max(...allLats).toFixed(4)}]`,
    );

    console.log("");
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
