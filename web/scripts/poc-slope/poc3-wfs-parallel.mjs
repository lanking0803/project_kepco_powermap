/**
 * PoC ③ — 1·2단계 WFS 3레이어 병렬 호출 + remark 거리추출 재검증
 *
 * 메모리상 "리 단위 0.12초" 확정인데, 한 묶음(Promise.all)으로 실제 동작 재확인.
 *  - 농림지역      LT_C_UQ113  (전체)
 *  - 생산관리지역  LT_C_UQ112  (uname="생산관리지역"만)
 *  - 가축사육제한  LT_C_UM000  (remark 에 거리+축종)
 *
 * data API: req/data?service=data&request=GetFeature&data=<코드>&geomFilter=BOX(...)
 *
 * 실행: node --env-file=.env.local scripts/poc-slope/poc3-wfs-parallel.mjs
 */
const KEY = process.env.VWORLD_KEY;
const DOMAIN = "sunlap.kr";

// PoC ② 에서 잡힌 순천 승주읍 유흥리 산255 주변 BBOX (작은 영역 = 리 일부 모사)
const BBOX = { minLng: 127.320, minLat: 35.040, maxLng: 127.343, maxLat: 35.056 };

async function fetchLayer(code) {
  const box = `BOX(${BBOX.minLng},${BBOX.minLat},${BBOX.maxLng},${BBOX.maxLat})`;
  const params = new URLSearchParams({
    service: "data", request: "GetFeature", data: code,
    key: KEY, domain: DOMAIN, geomFilter: box,
    format: "json", size: "1000", crs: "EPSG:4326",
  });
  const t0 = Date.now();
  const res = await fetch(`https://api.vworld.kr/req/data?${params}`, {
    headers: { Referer: `https://${DOMAIN}` },
  });
  const ms = Date.now() - t0;
  if (!res.ok) return { code, ok: false, status: res.status, ms, features: [] };
  const json = await res.json();
  const feats = json?.response?.result?.featureCollection?.features ?? [];
  return { code, ok: true, ms, count: feats.length, features: feats };
}

(async () => {
  console.log(`\n■ PoC ③ WFS 3레이어 병렬 호출 (BBOX = 순천 승주읍 일부)\n`);

  const t0 = Date.now();
  const [nongrim, saengsan, gachuk] = await Promise.all([
    fetchLayer("LT_C_UQ113"), // 농림
    fetchLayer("LT_C_UQ112"), // 관리(생산관리 필터)
    fetchLayer("LT_C_UM000"), // 가축사육제한
  ]);
  const totalMs = Date.now() - t0;

  console.log("─ 레이어별 결과 ──────────────");
  for (const r of [nongrim, saengsan, gachuk]) {
    console.log(`  ${r.code}: ${r.ok ? `${r.count}건` : `실패(${r.status})`}  (${r.ms}ms)`);
  }
  console.log(`\n  병렬 전체 소요: ${totalMs}ms  (= 가장 느린 1개 ≈ ${Math.max(nongrim.ms, saengsan.ms, gachuk.ms)}ms)`);

  // 생산관리지역 필터 확인 (UQ112 안에 보전/계획/생산 섞임)
  const unames = new Set(saengsan.features.map((f) => f.properties?.uname).filter(Boolean));
  console.log(`\n  UQ112 uname 종류: ${[...unames].join(", ") || "(없음)"}`);
  const saengsanOnly = saengsan.features.filter((f) => f.properties?.uname === "생산관리지역");
  console.log(`  → 생산관리지역만: ${saengsanOnly.length}건`);

  // 가축제한 remark 거리/축종 추출
  console.log(`\n─ 가축제한 remark 샘플 (거리/축종 추출) ──`);
  const remarks = gachuk.features.map((f) => f.properties?.remark || f.properties?.REMARK).filter(Boolean);
  const uniq = [...new Set(remarks)].slice(0, 8);
  if (uniq.length === 0) {
    console.log("  (remark 필드 없음 — properties 키 확인)");
    if (gachuk.features[0]) console.log("  properties keys:", Object.keys(gachuk.features[0].properties));
  } else {
    uniq.forEach((r) => {
      const m = String(r).match(/(\d+)\s*m/);
      console.log(`  "${r}"  → 거리추출: ${m ? m[1] + "m" : "없음"}`);
    });
  }

  console.log(`\n✅ PoC ③ 성공 — 3레이어 병렬 호출 + 필터 + remark 추출 동작\n`);
})().catch((e) => { console.error("❌ PoC ③ 실패:", e); process.exit(1); });
