/**
 * PoC ④ — 격자 음영 렌더링 (분석도처럼 색 이미지 출력)
 *
 * PoC ②의 필지 클리핑 결과를 색칠해 PNG 로 뽑는다.
 *  - 셀 경사도 → 구간색 매핑 (의뢰자 4색 + 분석도 다색 둘 다)
 *  - 필지 밖은 투명, 안쪽만 색
 *  - sharp 로 PNG 저장 → 시각 확인
 *
 * 색(의뢰자 기준):
 *   <10도 노랑 / 10~15 초록 / 15~22 회색 / 22+ 빨강
 *
 * 실행: node --env-file=.env.local scripts/poc-slope/poc4-render.mjs
 */
import sharp from "sharp";
import { readFileSync, mkdirSync } from "fs";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";

const Z = 14, X0 = 13986, Y0 = 6486, SIZE = 256, RAD2DEG = 180 / Math.PI;
const KEY = process.env.VWORLD_KEY, DOMAIN = "sunlap.kr";

function decodeElev(r, g, b) { return r * 256 + g + b / 256 - 32768; }
function pixelToLatLng(px, py) {
  const n = 2 ** Z;
  const lng = (px / (256 * n)) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / (256 * n))));
  return { lat: (latRad * 180) / Math.PI, lng };
}
// 의뢰자 4색 (RGB)
function slopeColor(deg) {
  if (deg < 10) return [255, 235, 59];   // 노랑
  if (deg < 15) return [76, 175, 80];    // 초록
  if (deg < 22) return [158, 158, 158];  // 회색
  return [229, 57, 53];                  // 빨강
}

async function fetchParcelAtPoint(lat, lng) {
  const d = 0.00005;
  const params = new URLSearchParams({
    key: KEY, domain: DOMAIN, service: "WFS", version: "2.0.0",
    request: "GetFeature", typename: "lt_c_landinfobasemap",
    output: "application/json", srsName: "EPSG:4326",
    bbox: [lng - d, lat - d, lng + d, lat + d].join(","), maxFeatures: "10",
  });
  const res = await fetch(`https://api.vworld.kr/req/wfs?${params}`, { headers: { Referer: `https://${DOMAIN}` } });
  const data = await res.json();
  const pt = { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [lng, lat] } };
  return data.features.find((f) => { try { return booleanPointInPolygon(pt, f); } catch { return false; } }) || data.features[0];
}

(async () => {
  console.log(`\n■ PoC ④ 격자 음영 렌더링\n`);
  const N = SIZE * 2;
  const elev = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let ty = 0; ty < 2; ty++)
    for (let tx = 0; tx < 2; tx++) {
      const { data, info } = await sharp(readFileSync(`scripts/poc-slope/data/t_${tx}_${ty}.png`)).raw().toBuffer({ resolveWithObject: true });
      const ch = info.channels;
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const i = (y * SIZE + x) * ch;
        elev[ty * SIZE + y][tx * SIZE + x] = decodeElev(data[i], data[i + 1], data[i + 2]);
      }
    }

  const center = pixelToLatLng(X0 * 256 + SIZE, Y0 * 256 + SIZE);
  const feature = await fetchParcelAtPoint(center.lat, center.lng);
  const p = feature.properties;
  console.log(`필지: ${p.emd_nm} ${p.ri_nm || ""} ${p.jibun} (${p.jimok})`);

  const mPerPx = (40075016 * Math.cos((center.lat * Math.PI) / 180)) / (2 ** Z) / 256;
  function triSlopeDeg(a, b, c) {
    const ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    return Math.acos(Math.min(1, Math.abs(nz)/Math.hypot(nx,ny,nz)))*RAD2DEG;
  }

  // 필지 bbox 픽셀범위로 잘라서 렌더 (전체 512² 중 필지 주변만)
  let minX=N, minY=N, maxX=0, maxY=0;
  const insideMask = Array.from({ length: N }, () => new Array(N).fill(false));
  for (let y = 0; y < N - 1; y++) for (let x = 0; x < N - 1; x++) {
    const ll = pixelToLatLng(X0*256 + x + 0.5, Y0*256 + y + 0.5);
    if (booleanPointInPolygon({ type:"Feature", properties:{}, geometry:{ type:"Point", coordinates:[ll.lng, ll.lat] } }, feature)) {
      insideMask[y][x] = true;
      if (x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y;
    }
  }
  const pad = 4;
  minX=Math.max(0,minX-pad); minY=Math.max(0,minY-pad); maxX=Math.min(N-2,maxX+pad); maxY=Math.min(N-2,maxY+pad);
  const W = maxX - minX + 1, H = maxY - minY + 1;
  const scale = 6; // 픽셀당 6배 확대 (보기 좋게)
  const outW = W * scale, outH = H * scale;
  const buf = Buffer.alloc(outW * outH * 4, 0); // RGBA, 기본 투명

  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    if (!insideMask[y][x]) continue;
    const P00={x:x*mPerPx,y:y*mPerPx,z:elev[y][x]}, P10={x:(x+1)*mPerPx,y:y*mPerPx,z:elev[y][x+1]};
    const P01={x:x*mPerPx,y:(y+1)*mPerPx,z:elev[y+1][x]}, P11={x:(x+1)*mPerPx,y:(y+1)*mPerPx,z:elev[y+1][x+1]};
    const d1=triSlopeDeg(P00,P10,P01), d2=triSlopeDeg(P10,P11,P01);
    const [r,g,b] = slopeColor((d1+d2)/2);
    for (let sy=0; sy<scale; sy++) for (let sx=0; sx<scale; sx++) {
      const ox=(x-minX)*scale+sx, oy=(y-minY)*scale+sy;
      const idx=(oy*outW+ox)*4;
      buf[idx]=r; buf[idx+1]=g; buf[idx+2]=b; buf[idx+3]=220;
    }
  }

  const outDir = "C:/cache/project_kepco_powermap/poc-slope";  // Drive 밖에 결과를 쓴다
  mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}/render-slope.png`;
  await sharp(buf, { raw: { width: outW, height: outH, channels: 4 } }).png().toFile(outPath);
  console.log(`\n✅ PoC ④ 성공 — 격자 음영 PNG 저장: ${outPath} (${outW}×${outH})`);
  console.log(`   색: 노랑<10° / 초록10~15° / 회색15~22° / 빨강22°+\n`);
})().catch((e) => { console.error("❌ PoC ④ 실패:", e); process.exit(1); });
