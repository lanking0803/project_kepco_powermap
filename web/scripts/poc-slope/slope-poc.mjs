/**
 * 경사도 PoC — 의뢰자 양계장 스크리닝 4단계(지형 필터) 검증
 *
 * 목적: "필지 1개를 격자로 쪼개 → 격자별 표고 조회 → 경사 계산 →
 *        15도 이하만 추출 → 면적/구성비(%) 통계" 가 우리 코드에서 도는지 증명.
 *
 * 데이터 소스: OpenTopoData srtm30m (공개 REST, 키 불필요) — PoC 검증용.
 *   운영 시에는 국토부 5m DEM 으로 교체 예정(해상도 ↑). 방법론은 동일.
 *
 * 실행: node scripts/poc-slope/slope-poc.mjs
 */

// ── 0. 테스트 필지: 순천 인근 산지 한 구역(경사 다양한 곳) ──
//    실제 필지 폴리곤 대신 PoC 는 사각형 영역으로 단순화(알고리즘 검증이 목적)
const PARCEL = {
  name: "순천 인근 산지 테스트 구역",
  minLat: 35.058, maxLat: 35.066,
  minLng: 127.306, maxLng: 127.316,
};

const GRID_N = 10;            // 10×10 = 100 격자
const SLOPE_LIMIT_DEG = 15;   // 의뢰자 기준(변수, 22도까지 조절 가능)

// ── 1. 격자 중심점 좌표 생성 ──
const latStep = (PARCEL.maxLat - PARCEL.minLat) / GRID_N;
const lngStep = (PARCEL.maxLng - PARCEL.minLng) / GRID_N;

// 경사 계산을 위해 각 격자의 "중심 + 동/북 이웃점"도 필요 → 격자점은 (N+1)×(N+1)
const points = [];
for (let i = 0; i <= GRID_N; i++) {
  for (let j = 0; j <= GRID_N; j++) {
    points.push({
      i, j,
      lat: PARCEL.minLat + i * latStep,
      lng: PARCEL.minLng + j * lngStep,
    });
  }
}

// ── 2. 표고 일괄 조회 (OpenTopoData, 한 호출 최대 100점) ──
async function fetchElevations(pts) {
  const out = [];
  const CHUNK = 100;
  for (let k = 0; k < pts.length; k += CHUNK) {
    const batch = pts.slice(k, k + CHUNK);
    const locs = batch.map((p) => `${p.lat},${p.lng}`).join("|");
    const url = `https://api.opentopodata.org/v1/srtm30m?locations=${locs}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`표고 API 실패: ${res.status}`);
    const json = await res.json();
    json.results.forEach((r, idx) => {
      out.push({ ...batch[idx], elev: r.elevation });
    });
    if (k + CHUNK < pts.length) await new Promise((r) => setTimeout(r, 1100)); // rate limit 예의
  }
  return out;
}

// 위경도 → 미터 거리 (작은 영역이라 평면 근사)
function metersPerDegLat() { return 111_320; }
function metersPerDegLng(lat) { return 111_320 * Math.cos((lat * Math.PI) / 180); }

(async () => {
  console.log(`\n■ PoC 시작 — ${PARCEL.name}`);
  console.log(`  격자: ${GRID_N}×${GRID_N} = ${GRID_N * GRID_N}개, 경사 기준 ${SLOPE_LIMIT_DEG}도 이하\n`);

  const t0 = Date.now();
  const elevPts = await fetchElevations(points);
  const fetchMs = Date.now() - t0;

  // 격자점 → 빠른 조회용 맵
  const grid = {};
  elevPts.forEach((p) => { grid[`${p.i},${p.j}`] = p; });

  // ── 3. 격자별 평균 경사 계산 ──
  //   각 격자의 경사 = 동쪽/북쪽 이웃과의 표고차로 기울기 산출 (rise/run)
  const cellLatM = latStep * metersPerDegLat();
  const cells = [];
  for (let i = 0; i < GRID_N; i++) {
    for (let j = 0; j < GRID_N; j++) {
      const c = grid[`${i},${j}`];
      const east = grid[`${i},${j + 1}`];
      const north = grid[`${i + 1},${j}`];
      const cellLngM = lngStep * metersPerDegLng(c.lat);

      const dzdx = (east.elev - c.elev) / cellLngM;   // 동서 기울기
      const dzdy = (north.elev - c.elev) / cellLatM;  // 남북 기울기
      const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
      const slopeDeg = (slopeRad * 180) / Math.PI;

      cells.push({ i, j, elev: c.elev, slopeDeg });
    }
  }

  // ── 4. 15도 이하 추출 + 면적/구성비 통계 ──
  const cellAreaM2 = cellLatM * (lngStep * metersPerDegLng(PARCEL.minLat));
  const totalCells = cells.length;
  const okCells = cells.filter((c) => c.slopeDeg <= SLOPE_LIMIT_DEG);
  const totalArea = totalCells * cellAreaM2;
  const okArea = okCells.length * cellAreaM2;

  // 경사 구간별 분포 (분석도처럼)
  const buckets = [
    [0, 5], [5, 10], [10, 15], [15, 20], [20, 25], [25, 30], [30, 90],
  ];
  console.log("─ 경사 구간별 분포 ────────────");
  buckets.forEach(([lo, hi]) => {
    const n = cells.filter((c) => c.slopeDeg >= lo && c.slopeDeg < hi).length;
    const pct = ((n / totalCells) * 100).toFixed(1);
    const bar = "█".repeat(Math.round(n / 2));
    console.log(`  ${String(lo).padStart(2)}~${String(hi).padStart(2)}도: ${String(n).padStart(3)}칸 ${pct.padStart(5)}%  ${bar}`);
  });

  console.log("\n─ 최종 판정 (양계장 가능 = 경사 15도 이하) ──");
  console.log(`  전체 면적   : ${totalArea.toFixed(0)} m² (${(totalArea / 3.3058).toFixed(0)}평)`);
  console.log(`  허가가능 면적: ${okArea.toFixed(0)} m² (${(okArea / 3.3058).toFixed(0)}평)`);
  console.log(`  구성비       : ${((okArea / totalArea) * 100).toFixed(1)}%  ← 팝업 출력값`);
  console.log(`\n─ 성능 ────────────`);
  console.log(`  표고 조회 점수: ${points.length}점`);
  console.log(`  표고 조회 시간: ${fetchMs}ms`);
  console.log(`  계산 시간     : ${Date.now() - t0 - fetchMs}ms`);
  console.log(`\n✅ PoC 성공 — 격자 경사 계산 → 15도 판정 → 면적/구성비 산출까지 동작\n`);
})().catch((e) => {
  console.error("\n❌ PoC 실패:", e.message, "\n");
  process.exit(1);
});
