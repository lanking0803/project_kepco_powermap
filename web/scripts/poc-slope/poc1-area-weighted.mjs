/**
 * PoC ① — 산지관리법 시행규칙 "평균경사도" 면적가중 공식 (삼각망 TIN)
 *
 * 의뢰자 "평균경사도 조사서" 공식:
 *   평균경사도 dm = Σ(di × Ai) / Σ Ai
 *     di = 각 삼각망(구분)별 경사도
 *     Ai = 각 삼각망의 (격자에 투영된) 2차원 평면적
 *   → 산지관리법 시행규칙 [별표] 방식. 단순 점-차분(현 PoC v2)이 아님.
 *
 * 검증: 같은 타일 데이터로
 *   (A) 현 단순차분 방식  vs  (B) 삼각망 면적가중 공식
 *   두 평균경사도 값을 비교 + 조사서 구간표(면적/구성비) 출력.
 *
 * 실행: node scripts/poc-slope/poc1-area-weighted.mjs
 */
import sharp from "sharp";
import { readFileSync } from "fs";

const Z = 14;
const SIZE = 256;
const RAD2DEG = 180 / Math.PI;

function decodeElev(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

(async () => {
  console.log(`\n■ PoC ① 면적가중 평균경사도 공식 (산지관리법 시행규칙)\n`);

  // 2×2 타일 → 512×512 표고격자
  const N = SIZE * 2;
  const elev = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const path = `scripts/poc-slope/data/t_${tx}_${ty}.png`;
      const { data, info } = await sharp(readFileSync(path)).raw().toBuffer({ resolveWithObject: true });
      const ch = info.channels;
      for (let y = 0; y < SIZE; y++)
        for (let x = 0; x < SIZE; x++) {
          const i = (y * SIZE + x) * ch;
          elev[ty * SIZE + y][tx * SIZE + x] = decodeElev(data[i], data[i + 1], data[i + 2]);
        }
    }
  }

  const mPerPx = (40075016 * Math.cos((35.062 * Math.PI) / 180)) / (2 ** Z) / 256;
  const dx = mPerPx, dy = mPerPx; // 픽셀 간 수평거리(m)
  console.log(`픽셀 해상도: ${dx.toFixed(2)}m,  격자 ${N}×${N}\n`);

  // ─────────────────────────────────────────────────────────
  // (A) 현 방식: 점-차분 경사 → 단순 산술평균
  // ─────────────────────────────────────────────────────────
  let sumSimple = 0, cntSimple = 0;
  for (let y = 0; y < N - 1; y++)
    for (let x = 0; x < N - 1; x++) {
      const dzdx = (elev[y][x + 1] - elev[y][x]) / dx;
      const dzdy = (elev[y + 1][x] - elev[y][x]) / dy;
      const slope = Math.atan(Math.hypot(dzdx, dzdy)) * RAD2DEG;
      sumSimple += slope; cntSimple++;
    }
  const dmSimple = sumSimple / cntSimple;

  // ─────────────────────────────────────────────────────────
  // (B) 산지관리법: 격자 셀 → 삼각형 2개(TIN), 삼각형별 di·Ai → Σ(di·Ai)/ΣAi
  //   셀 4점:  P00(좌상) P10(우상) / P01(좌하) P11(우하)
  //   삼각1 = P00,P10,P01   삼각2 = P10,P11,P01
  //   각 삼각형의 경사도 di = 법선벡터와 수직축의 각.
  //   Ai = "격자에 투영된 2차원 평면적" = 평면(수평) 삼각형 면적 = dx*dy/2 (셀당 합 = dx*dy).
  // ─────────────────────────────────────────────────────────
  // 삼각형 3D 3점으로 경사도(수평면 대비 각) 계산
  function triSlopeDeg(p1, p2, p3) {
    // 두 변 벡터의 외적 = 법선
    const ux = p2.x - p1.x, uy = p2.y - p1.y, uz = p2.z - p1.z;
    const vx = p3.x - p1.x, vy = p3.y - p1.y, vz = p3.z - p1.z;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const nlen = Math.hypot(nx, ny, nz);
    // 수평면 법선 = (0,0,1). 경사각 = 두 법선 사이각 = acos(|nz|/|n|)
    const cos = Math.abs(nz) / nlen;
    return Math.acos(Math.min(1, cos)) * RAD2DEG;
  }

  // 조사서 구간 (10도단위 변형: 의뢰자 색구간 + 5도단위 둘다 집계)
  const buckets = [[0,5],[5,10],[10,15],[15,20],[20,25],[25,30],[30,35],[35,40],[40,90]];
  const areaByBucket = new Array(buckets.length).fill(0);

  let sumDiAi = 0, sumAi = 0;
  const triArea2D = (dx * dy) / 2; // 투영 2차원 면적(삼각형 1개)

  for (let y = 0; y < N - 1; y++)
    for (let x = 0; x < N - 1; x++) {
      // 픽셀좌표를 미터로 (x*dx, y*dy), z=표고
      const P00 = { x: x * dx,        y: y * dy,        z: elev[y][x] };
      const P10 = { x: (x + 1) * dx,  y: y * dy,        z: elev[y][x + 1] };
      const P01 = { x: x * dx,        y: (y + 1) * dy,  z: elev[y + 1][x] };
      const P11 = { x: (x + 1) * dx,  y: (y + 1) * dy,  z: elev[y + 1][x + 1] };

      for (const [a, b, c] of [[P00, P10, P01], [P10, P11, P01]]) {
        const di = triSlopeDeg(a, b, c);
        const Ai = triArea2D;
        sumDiAi += di * Ai;
        sumAi += Ai;
        for (let k = 0; k < buckets.length; k++)
          if (di >= buckets[k][0] && di < buckets[k][1]) { areaByBucket[k] += Ai; break; }
      }
    }
  const dmAreaWeighted = sumDiAi / sumAi;

  // ── 출력 ──
  console.log("─ 조사서 구간표 (면적가중, 산지관리법 방식) ──────────");
  buckets.forEach(([lo, hi], k) => {
    const pct = (areaByBucket[k] / sumAi) * 100;
    const bar = "█".repeat(Math.round(pct / 2));
    console.log(`  ${String(lo).padStart(2)}~${String(hi).padStart(2)}도: ${(areaByBucket[k]).toFixed(0).padStart(9)} m²  ${pct.toFixed(2).padStart(6)}%  ${bar}`);
  });
  console.log(`  ${"합계".padStart(7)}: ${sumAi.toFixed(0).padStart(9)} m²  100.00%`);

  console.log(`\n─ 평균경사도 비교 ───────────────────`);
  console.log(`  (A) 단순 점-차분 평균   dm = ${dmSimple.toFixed(2)}°`);
  console.log(`  (B) 면적가중 삼각망 공식 dm = ${dmAreaWeighted.toFixed(2)}°   ← 산지관리법 조사서`);
  console.log(`      차이 = ${(dmAreaWeighted - dmSimple).toFixed(2)}°`);

  console.log(`\n─ 용도 판정 (면적가중 dm 기준) ──`);
  console.log(`  태양광(15도 미만): ${dmAreaWeighted < 15 ? "✅ 가능" : "❌ 초과"}`);
  console.log(`  양계장(22도 미만): ${dmAreaWeighted < 22 ? "✅ 가능" : "❌ 초과"}`);
  console.log(`\n✅ PoC ① 성공 — 산지관리법 면적가중 공식 동작, 조사서 표 산출 완료\n`);
})().catch((e) => { console.error("❌ PoC ① 실패:", e); process.exit(1); });
