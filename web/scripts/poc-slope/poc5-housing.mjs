/**
 * PoC ⑤ — 3단계 주변 민가 (유일한 미검증 병목) 실측
 *
 * 검증 3가지:
 *   (a) 시골 리(법정동) 1개에 건물 몇 동? (페이지 순회 부담)
 *   (b) 주용도(mainPurpsCdNm)로 주택 vs 시설 분류가 깔끔히 되나? (의뢰자 초록/빨강)
 *   (c) 건물 주소 → 좌표 지오코딩 실제 시간 (= 병목 핵심)
 *
 * 데이터:
 *   - 건축물대장: apis.data.go.kr getBrTitleInfo (법정동 단위, 100 cap, 호출당 500ms)
 *   - 지오코딩:   api.vworld.kr/req/address (주소→좌표)
 *
 * 실행: node --env-file=.env.local scripts/poc-slope/poc5-housing.mjs
 */
const DATA_KEY = process.env.DATA_GO_KR_KEY;
const VWORLD_KEY = process.env.VWORLD_KEY;
const DOMAIN = "sunlap.kr";

// 순천 승주읍 유흥리 — 법정동코드 필요. 승주읍 유흥리 bjdCode 조회는 생략하고
// 알려진 코드 사용: 순천시(46150) + 승주읍 유흥리. VWorld 검색으로 bjd 확인.
// 안전하게: 먼저 주소검색으로 한 지번 PNU 뽑아 앞10자리=법정동코드 사용.
const SAMPLE_ADDR = "전라남도 순천시 승주읍 유흥리 255";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 주소 → PNU (법정동코드 추출용)
async function addrToPnu(addr) {
  const params = new URLSearchParams({
    service: "search", request: "search", version: "2.0", crs: "EPSG:4326",
    size: "5", page: "1", query: addr, type: "address", category: "parcel",
    format: "json", errorformat: "json", key: VWORLD_KEY, domain: DOMAIN,
  });
  const res = await fetch(`https://api.vworld.kr/req/search?${params}`, { headers: { Referer: `https://${DOMAIN}` } });
  const d = await res.json();
  return d?.response?.result?.items?.[0]?.id ?? null;
}

// 건축물대장 법정동 일괄 (1페이지)
async function listBuildings(bjdCode, pageNo) {
  const params = new URLSearchParams({
    serviceKey: DATA_KEY, sigunguCd: bjdCode.slice(0, 5), bjdongCd: bjdCode.slice(5, 10),
    _type: "json", numOfRows: "100", pageNo: String(pageNo),
  });
  const res = await fetch(`https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`건축HUB HTTP ${res.status}`);
  const d = await res.json();
  const body = d?.response?.body;
  const total = Number(body?.totalCount ?? 0);
  let rows = [];
  const items = body?.items;
  if (items && typeof items === "object" && items.item) {
    rows = Array.isArray(items.item) ? items.item : [items.item];
  }
  return { total, rows };
}

// 주용도 → 주택/시설/기타 분류 (의뢰자: 주택=초록, 공장·축사·창고·영업시설=빨강)
function classify(purps) {
  const p = purps || "";
  if (/주택|아파트|연립|다세대|숙박|기숙사/.test(p)) return "주택";
  // 동물및식물관련시설 = 축사/돈사/계사 → 시설(빨강). 의뢰자: 축사=빨강.
  if (/공장|창고|축사|동물|식물|제조|판매|근린생활|업무|영업|위험물|자동차|종교|운동|문화/.test(p)) return "시설";
  return "기타";
}

// 주소 → 좌표 (지오코딩)
async function geocode(addr) {
  const params = new URLSearchParams({
    service: "address", request: "getcoord", version: "2.0", crs: "EPSG:4326",
    address: addr, format: "json", type: "parcel", key: VWORLD_KEY,
  });
  const t0 = Date.now();
  const res = await fetch(`https://api.vworld.kr/req/address?${params}`, { headers: { Referer: `https://${DOMAIN}` } });
  const ms = Date.now() - t0;
  const d = await res.json();
  const pt = d?.response?.result?.point;
  return { ms, ok: d?.response?.status === "OK", lat: pt ? Number(pt.y) : null, lng: pt ? Number(pt.x) : null };
}

(async () => {
  console.log(`\n■ PoC ⑤ 3단계 주변 민가 실측\n`);

  // 0. 법정동 코드 확보
  const pnu = await addrToPnu(SAMPLE_ADDR);
  if (!pnu) { console.error("❌ PNU 조회 실패"); process.exit(1); }
  const bjdCode = pnu.slice(0, 10);
  console.log(`샘플 PNU: ${pnu} → 법정동코드: ${bjdCode}\n`);

  // (a) 건물 전체 동수 + 페이지 순회 시간
  console.log("─ (a) 건물 목록 조회 (법정동 단위) ──");
  const tList0 = Date.now();
  const all = [];
  let page = 1, total = 0;
  do {
    const { total: t, rows } = await listBuildings(bjdCode, page);
    total = t;
    all.push(...rows);
    console.log(`  page ${page}: ${rows.length}건 (누적 ${all.length}/${total})`);
    if (page * 100 >= total) break;
    page++;
    await sleep(500); // 운영 동일 지연
  } while (all.length < total && page <= 50);
  const listMs = Date.now() - tList0;
  console.log(`  → 총 ${all.length}동, 페이지 ${page}회, 소요 ${listMs}ms (${(listMs/1000).toFixed(1)}초)\n`);

  // (b) 주택/시설 분류
  console.log("─ (b) 주용도 분류 (주택=초록 / 시설=빨강) ──");
  const byClass = { 주택: 0, 시설: 0, 기타: 0 };
  const purpsSet = {};
  for (const r of all) {
    const c = classify(r.mainPurpsCdNm);
    byClass[c]++;
    const key = `${c}: ${r.mainPurpsCdNm || "(빈값)"}`;
    purpsSet[key] = (purpsSet[key] || 0) + 1;
  }
  console.log(`  주택 ${byClass.주택} / 시설 ${byClass.시설} / 기타 ${byClass.기타}`);
  console.log(`  주용도 분포:`);
  Object.entries(purpsSet).sort((a,b)=>b[1]-a[1]).slice(0, 15).forEach(([k, n]) => console.log(`    ${k} ×${n}`));

  // (c) 지오코딩 시간 (샘플 — 주택만, 최대 10건)
  console.log(`\n─ (c) 지오코딩 시간 측정 (주택 샘플) ──`);
  const houses = all.filter((r) => classify(r.mainPurpsCdNm) === "주택")
    .map((r) => r.platPlc || r.newPlatPlc).filter(Boolean).slice(0, 10);
  if (houses.length === 0) {
    console.log("  주택 0건 — 시설/기타로 대체 측정");
    houses.push(...all.map((r) => r.platPlc || r.newPlatPlc).filter(Boolean).slice(0, 10));
  }
  let geoOk = 0, geoMsSum = 0;
  for (const addr of houses) {
    const g = await geocode(addr);
    geoMsSum += g.ms;
    if (g.ok) geoOk++;
    console.log(`  ${g.ok ? "✅" : "❌"} ${g.ms}ms  ${addr.slice(0, 40)}${g.lat ? ` → ${g.lat.toFixed(5)},${g.lng.toFixed(5)}` : ""}`);
    await sleep(100);
  }
  const avgGeo = houses.length ? Math.round(geoMsSum / houses.length) : 0;

  // 추산
  console.log(`\n─ 종합 추산 (이 리 기준) ────────`);
  console.log(`  건물 ${all.length}동, 주택 ${byClass.주택}동`);
  console.log(`  목록조회: ${(listMs/1000).toFixed(1)}초`);
  console.log(`  지오코딩 평균: ${avgGeo}ms/건, 성공률 ${houses.length?Math.round(geoOk/houses.length*100):0}%`);
  const estGeoAll = (byClass.주택 + byClass.시설) * (avgGeo + 100) / 1000;
  console.log(`  전체 지오코딩 추산(주택+시설 ${byClass.주택+byClass.시설}건 × ${avgGeo+100}ms): ${estGeoAll.toFixed(1)}초`);
  console.log(`  ⇒ 리 1개 첫 조회 총 추산: ${((listMs/1000)+estGeoAll).toFixed(1)}초`);
  console.log(`\n✅ PoC ⑤ 완료 — 3단계 병목 실측\n`);
})().catch((e) => { console.error("❌ PoC ⑤ 실패:", e); process.exit(1); });
