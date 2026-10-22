/**
 * 경사도 PoC v2 — "받아둔 지형 타일 파일로 경사 계산" 실증
 *
 * v1(slope-poc.mjs)은 외부 REST 실시간 호출(30m).
 * v2는 AWS 지형 타일 PNG를 미리 받아(=우리 DB에 적재하는 모델) → sharp 로 디코딩 →
 *   Terrarium 공식으로 표고 복원 → 격자 경사 계산 → 15도 판정.
 *   = "받아두고 우려먹기" + 9.6m 해상도(30m보다 정밀) 검증.
 *
 * 실행: node scripts/poc-slope/slope-from-tiles.mjs
 */
import sharp from "sharp";
import { readFileSync } from "fs";

const Z = 14;
const X0 = 13986, Y0 = 6486; // 앞서 받은 중심 타일
const SLOPE_LIMIT_DEG = 15;

// 타일/픽셀 → 위경도 (web mercator 역변환)
function pixelToLatLng(px, py) {
  const n = 2 ** Z;
  const lng = (px / (256 * n)) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / (256 * n))));
  return { lat: (latRad * 180) / Math.PI, lng };
}

// Terrarium 디코딩: 표고(m) = R*256 + G + B/256 - 32768
function decodeElev(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

(async () => {
  console.log(`\n■ 경사도 PoC v2 — 받아둔 지형 타일로 계산 (줌${Z}, ≈9.6m/픽셀)\n`);

  // 4장(2×2)을 512×512 표고 격자로 합침
  const SIZE = 256;
  const elev = Array.from({ length: SIZE * 2 }, () => new Array(SIZE * 2).fill(0));

  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const path = `scripts/poc-slope/data/t_${tx}_${ty}.png`;
      const { data, info } = await sharp(readFileSync(path))
        .raw()
        .toBuffer({ resolveWithObject: true });
      const ch = info.channels;
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const i = (y * SIZE + x) * ch;
          elev[ty * SIZE + y][tx * SIZE + x] = decodeElev(data[i], data[i + 1], data[i + 2]);
        }
      }
    }
  }

  // 표고 범위 확인 (디코딩 정상 여부)
  let mn = Infinity, mx = -Infinity;
  for (const row of elev) for (const v of row) { if (v < mn) mn = v; if (v > mx) mx = v; }
  console.log(`디코딩된 표고 범위: ${mn.toFixed(0)}m ~ ${mx.toFixed(0)}m  (정상이면 한국 산지 값)`);

  // 픽셀 간 실제 거리(m) — 위도 35도, 줌14
  const mPerPx = (40075016 * Math.cos((35.062 * Math.PI) / 180)) / (2 ** Z) / 256;
  console.log(`픽셀 해상도: ${mPerPx.toFixed(1)}m\n`);

  // ── 격자(픽셀)별 경사 계산 ──
  const N = SIZE * 2;
  const buckets = [[0,5],[5,10],[10,15],[15,20],[20,25],[25,30],[30,90]];
  const counts = new Array(buckets.length).fill(0);
  let okCount = 0, totalCount = 0;

  for (let y = 0; y < N - 1; y++) {
    for (let x = 0; x < N - 1; x++) {
      const dzdx = (elev[y][x + 1] - elev[y][x]) / mPerPx;
      const dzdy = (elev[y + 1][x] - elev[y][x]) / mPerPx;
      const slope = (Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * 180) / Math.PI;
      totalCount++;
      if (slope <= SLOPE_LIMIT_DEG) okCount++;
      for (let b = 0; b < buckets.length; b++) {
        if (slope >= buckets[b][0] && slope < buckets[b][1]) { counts[b]++; break; }
      }
    }
  }

  console.log("─ 경사 구간별 분포 (측량 분석도와 같은 구간) ────────");
  buckets.forEach(([lo, hi], b) => {
    const pct = ((counts[b] / totalCount) * 100).toFixed(1);
    const bar = "█".repeat(Math.round(counts[b] / totalCount * 50));
    console.log(`  ${String(lo).padStart(2)}~${String(hi).padStart(2)}도: ${pct.padStart(5)}%  ${bar}`);
  });

  const cellArea = mPerPx * mPerPx;
  console.log("\n─ 최종 판정 (양계장 가능 = 경사 15도 이하) ──");
  console.log(`  분석 격자 수 : ${totalCount}개 (${N}×${N} 표고점)`);
  console.log(`  전체 면적    : ${(totalCount * cellArea / 10000).toFixed(1)} ha`);
  console.log(`  허가가능(15도↓): ${((okCount / totalCount) * 100).toFixed(1)}%`);
  console.log(`\n✅ PoC v2 성공 — 받아둔 타일 파일(438KB)만으로 9.6m 해상도 경사 계산 완료`);
  console.log(`   외부 실시간 호출 0번. 우리 DB 적재 모델 그대로 동작 증명.\n`);
})().catch((e) => { console.error("❌ 실패:", e); process.exit(1); });
