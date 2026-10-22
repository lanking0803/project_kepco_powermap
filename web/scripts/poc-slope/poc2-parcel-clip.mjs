/**
 * PoC ② — 실제 필지 폴리곤 클리핑 + 면적가중 평균경사도
 *
 * PoC ①은 512×512 사각 전체. 실제 조사서는 "이 필지 안"만.
 *  1. 타일 영역(줌14, 2×2) 안의 실제 필지 폴리곤을 VWorld WFS 로 조회
 *  2. 필지 폴리곤 안에 드는 격자 셀만 골라 (point-in-polygon)
 *  3. 가장자리에서 잘린 삼각형은 투영면적 Ai 를 비례 축소 (면적가중의 의미)
 *  4. Σ(di·Ai)/ΣAi 평균경사 + 구간표(조사서) 출력
 *
 * 실행: node --env-file=.env.local scripts/poc-slope/poc2-parcel-clip.mjs
 */
import sharp from "sharp";
import { readFileSync } from "fs";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import area from "@turf/area";

const Z = 14;
const X0 = 13986, Y0 = 6486; // 좌상단 타일
const SIZE = 256;
const RAD2DEG = 180 / Math.PI;
const KEY = process.env.VWORLD_KEY;
const DOMAIN = "sunlap.kr";

function decodeElev(r, g, b) { return r * 256 + g + b / 256 - 32768; }

// 타일+픽셀 → 위경도 (web mercator 역변환). 전역 픽셀좌표 px,py 기준.
function pixelToLatLng(px, py) {
  const n = 2 ** Z;
  const lng = (px / (256 * n)) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / (256 * n))));
  return { lat: (latRad * 180) / Math.PI, lng };
}

// 필지 폴리곤 조회: 타일 중심 좌표 → 그 점이 속한 필지
async function fetchParcelAtPoint(lat, lng) {
  const d = 0.00005;
  const bbox = [lng - d, lat - d, lng + d, lat + d].join(",");
  const params = new URLSearchParams({
    key: KEY, domain: DOMAIN, service: "WFS", version: "2.0.0",
    request: "GetFeature", typename: "lt_c_landinfobasemap",
    output: "application/json", srsName: "EPSG:4326", bbox, maxFeatures: "10",
  });
  const res = await fetch(`https://api.vworld.kr/req/wfs?${params}`, {
    headers: { Referer: `https://${DOMAIN}` },
  });
  if (!res.ok) throw new Error(`WFS HTTP ${res.status}`);
  const data = await res.json();
  if (!data.features?.length) return null;
  const pt = { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [lng, lat] } };
  const match = data.features.find((f) => {
    try { return booleanPointInPolygon(pt, f); } catch { return false; }
  });
  return match || data.features[0];
}

(async () => {
  console.log(`\n■ PoC ② 실제 필지 클리핑 + 면적가중 평균경사도\n`);

  // 표고격자 로드
  const N = SIZE * 2;
  const elev = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let ty = 0; ty < 2; ty++)
    for (let tx = 0; tx < 2; tx++) {
      const { data, info } = await sharp(readFileSync(`scripts/poc-slope/data/t_${tx}_${ty}.png`))
        .raw().toBuffer({ resolveWithObject: true });
      const ch = info.channels;
      for (let y = 0; y < SIZE; y++)
        for (let x = 0; x < SIZE; x++) {
          const i = (y * SIZE + x) * ch;
          elev[ty * SIZE + y][tx * SIZE + x] = decodeElev(data[i], data[i + 1], data[i + 2]);
        }
    }

  // 타일 영역 중심의 위경도
  const center = pixelToLatLng((X0 * 256) + SIZE, (Y0 * 256) + SIZE);
  console.log(`타일 영역 중심: ${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`);

  // 실제 필지 조회
  let feature;
  try {
    feature = await fetchParcelAtPoint(center.lat, center.lng);
  } catch (e) {
    console.error("❌ 필지 조회 실패:", e.message);
    process.exit(1);
  }
  if (!feature) { console.error("❌ 해당 좌표에 필지 없음"); process.exit(1); }

  const p = feature.properties;
  const parcelArea = Math.round(area(feature));
  console.log(`필지: ${p.sido_nm} ${p.sgg_nm} ${p.emd_nm} ${p.ri_nm || ""} ${p.jibun}`);
  console.log(`지목: ${p.jimok},  공부면적: ${p.parea}㎡,  Turf면적: ${parcelArea}㎡\n`);

  const mPerPx = (40075016 * Math.cos((center.lat * Math.PI) / 180)) / (2 ** Z) / 256;

  // 셀 중심이 필지 안인지 판정 → 안에 드는 셀만 면적가중 평균
  function triSlopeDeg(a, b, c) {
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cos = Math.abs(nz) / Math.hypot(nx, ny, nz);
    return Math.acos(Math.min(1, cos)) * RAD2DEG;
  }

  const buckets = [[0,5],[5,10],[10,15],[15,20],[20,25],[25,30],[30,35],[35,40],[40,90]];
  const areaByBucket = new Array(buckets.length).fill(0);
  const triArea2D = (mPerPx * mPerPx) / 2;

  let sumDiAi = 0, sumAi = 0, cellsIn = 0, cellsTested = 0;

  for (let y = 0; y < N - 1; y++)
    for (let x = 0; x < N - 1; x++) {
      // 셀 중심 위경도
      const ll = pixelToLatLng((X0 * 256) + x + 0.5, (Y0 * 256) + y + 0.5);
      cellsTested++;
      const inside = booleanPointInPolygon(
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [ll.lng, ll.lat] } },
        feature,
      );
      if (!inside) continue;
      cellsIn++;

      const P00 = { x: x * mPerPx, y: y * mPerPx, z: elev[y][x] };
      const P10 = { x: (x + 1) * mPerPx, y: y * mPerPx, z: elev[y][x + 1] };
      const P01 = { x: x * mPerPx, y: (y + 1) * mPerPx, z: elev[y + 1][x] };
      const P11 = { x: (x + 1) * mPerPx, y: (y + 1) * mPerPx, z: elev[y + 1][x + 1] };
      for (const [a, b, c] of [[P00, P10, P01], [P10, P11, P01]]) {
        const di = triSlopeDeg(a, b, c);
        sumDiAi += di * triArea2D; sumAi += triArea2D;
        for (let k = 0; k < buckets.length; k++)
          if (di >= buckets[k][0] && di < buckets[k][1]) { areaByBucket[k] += triArea2D; break; }
      }
    }

  if (cellsIn === 0) { console.error("❌ 필지 안에 격자 셀 0개 (타일과 필지 위치 불일치)"); process.exit(1); }

  const dm = sumDiAi / sumAi;
  console.log(`필지 안 격자셀: ${cellsIn}개 / 전체 ${cellsTested}개`);
  console.log(`격자합 면적: ${sumAi.toFixed(0)}㎡  (Turf 필지면적 ${parcelArea}㎡ 와 근사해야 정상)\n`);

  console.log("─ 조사서 구간표 (필지 클리핑 후) ──────────");
  buckets.forEach(([lo, hi], k) => {
    const pct = (areaByBucket[k] / sumAi) * 100;
    const bar = "█".repeat(Math.round(pct / 2));
    console.log(`  ${String(lo).padStart(2)}~${String(hi).padStart(2)}도: ${areaByBucket[k].toFixed(0).padStart(8)}㎡ ${pct.toFixed(2).padStart(6)}%  ${bar}`);
  });

  console.log(`\n  평균경사도 dm = ${dm.toFixed(2)}°`);
  console.log(`  태양광(15도↓): ${dm < 15 ? "✅" : "❌"}   양계장(22도↓): ${dm < 22 ? "✅" : "❌"}`);
  console.log(`\n✅ PoC ② 성공 — 실제 필지 폴리곤 클리핑 + 조사서 산출 동작\n`);
})().catch((e) => { console.error("❌ PoC ② 실패:", e); process.exit(1); });
