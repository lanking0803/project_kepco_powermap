export {};
/**
 * 다양 케이스 검증 — 견적 모드 진입 시 어떤 응답이 오는지 미리 파악.
 *
 * 분석 항목 (PNU 별):
 *   - 동 수
 *   - 동마다 점 개수
 *   - 면적 분포
 *   - 가장 복잡한 폴리곤의 점 개수
 *
 * 실행:
 *   cd web && npx tsx --env-file=.env.local scripts/test-vworld-buildings/04-cases.ts
 */

const VWORLD_KEY = process.env.VWORLD_KEY ?? "";
const WFS_URL = "https://api.vworld.kr/req/wfs";
const REFERER = "https://sunlap.kr";

interface Case {
  label: string;
  pnu: string;
  expect: string;
}

const CASES: Case[] = [
  {
    label: "직리 179 — 단일 동 검증 베이스라인",
    pnu: "4783035035101790000",
    expect: "1동, 5점 사각형",
  },
  {
    label: "직리 174 — 다중 동 (4동, 점 개수 다양)",
    pnu: "4783035035101740000",
    expect: "4동, 5/17/5/7점",
  },
  {
    label: "직리 178 — 단일 동",
    pnu: "4783035035101780000",
    expect: "1동",
  },
  {
    label: "직리 183 — 옆 필지",
    pnu: "4783035035101830000",
    expect: "1~2동",
  },
  {
    label: "서울시청 PNU (도시 큰 건물)",
    pnu: "1114010300100310000",
    expect: "1~2동, 큰 면적, 점 많음",
  },
  {
    label: "서울 무교동 작은 필지",
    pnu: "1114010100100200000",
    expect: "다중 동",
  },
  {
    label: "임야 (산 지번, 빈 땅 시뮬)",
    pnu: "4783035035201290002",
    expect: "0동 (가설건축물도 없음)",
  },
];

async function call(pnu: string) {
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
    typename: "lt_c_spbd",
    output: "application/json",
    srsName: "EPSG:4326",
    FILTER: filter,
  });
  const start = Date.now();
  const res = await fetch(`${WFS_URL}?${params}`, {
    headers: { Referer: REFERER },
  });
  const ms = Date.now() - start;
  if (!res.ok) {
    return { ok: false, status: res.status, ms, features: [] as any[] };
  }
  const data = (await res.json()) as { features?: any[] };
  return { ok: true, status: 200, ms, features: data.features ?? [] };
}

function pointCount(geom: any): number {
  if (!geom) return 0;
  if (geom.type === "Polygon") return geom.coordinates[0]?.length ?? 0;
  if (geom.type === "MultiPolygon") return geom.coordinates[0]?.[0]?.length ?? 0;
  return 0;
}

function approxAreaM2(geom: any): number {
  // 매우 거칠게 — bbox 면적으로 근사 (실제 Turf 안 씀, 빠른 분석용)
  const ring =
    geom.type === "Polygon" ? geom.coordinates[0] : geom.coordinates[0][0];
  if (!ring || ring.length < 3) return 0;
  const lngs = ring.map((c: number[]) => c[0]);
  const lats = ring.map((c: number[]) => c[1]);
  const dLng = Math.max(...lngs) - Math.min(...lngs);
  const dLat = Math.max(...lats) - Math.min(...lats);
  // 위도 35° 기준 1° ≈ 111km
  const wM = dLng * 111000 * Math.cos((lats[0] * Math.PI) / 180);
  const hM = dLat * 111000;
  return Math.round(wM * hM * 0.7); // 거칠게 70% 채움 가정
}

async function main() {
  if (!VWORLD_KEY) {
    console.error("VWORLD_KEY 미설정");
    process.exit(1);
  }
  console.log("PNU                  | label                                          | 동 | 점개수      | 면적합(㎡)  | ms");
  console.log("-".repeat(120));
  for (const c of CASES) {
    const r = await call(c.pnu);
    if (!r.ok) {
      console.log(
        `${c.pnu} | ${c.label.padEnd(46)} | -- | HTTP ${r.status}  | --        | ${r.ms}`,
      );
      continue;
    }
    const points = r.features.map((f) => pointCount(f.geometry));
    const areas = r.features.map((f) => approxAreaM2(f.geometry));
    const totalArea = areas.reduce((a, b) => a + b, 0);
    const pointStr = points.length === 0 ? "0" : points.join("/");
    console.log(
      `${c.pnu} | ${c.label.padEnd(46)} | ${String(r.features.length).padStart(2)} | ${pointStr.padEnd(11)} | ${String(totalArea).padStart(9)} | ${r.ms}`,
    );
    console.log(`                    └ 기대: ${c.expect}`);
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
