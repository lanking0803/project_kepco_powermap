/**
 * 광주 농성동 391-15 PNU 매칭 실패 원인 추적.
 *
 * 시도:
 *   1. PNU 정확 매칭 (현재 방식)
 *   2. PNU 본번-부번 변경 (391, 391-1, 391-13 등)
 *   3. 동 단위 BBOX 로 농성동 391 모든 필지 나열 (어떤 부번이 실제 있는지)
 *   4. VWorld 검색 API (한글주소 → PNU 역변환) 시도
 */

import * as fs from "fs";
import * as path from "path";

const envPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

const KEY = process.env.VWORLD_KEY!;
const DOMAIN = "localhost";
const WFS = "https://api.vworld.kr/req/wfs";
const LAYER = "lt_c_landinfobasemap";

// 광주광역시 서구 농성동 = bjd_code 2914010600
const TARGET_BJD = "2914010600";

async function callWfsByPnu(pnu: string) {
  const filter =
    `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0">` +
    `<fes:PropertyIsEqualTo>` +
    `<fes:ValueReference>pnu</fes:ValueReference>` +
    `<fes:Literal>${pnu}</fes:Literal>` +
    `</fes:PropertyIsEqualTo>` +
    `</fes:Filter>`;
  const url = new URL(WFS);
  url.searchParams.set("key", KEY);
  url.searchParams.set("domain", DOMAIN);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("version", "2.0.0");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("typename", LAYER);
  url.searchParams.set("output", "application/json");
  url.searchParams.set("srsName", "EPSG:4326");
  url.searchParams.set("FILTER", filter);
  const res = await fetch(url.toString(), {
    headers: { Referer: `https://${DOMAIN}` },
  });
  const text = await res.text();
  if (!text.startsWith("{")) {
    return { error: text.slice(0, 200), features: 0 };
  }
  const data = JSON.parse(text);
  return { features: data.features?.length ?? 0, sample: data.features?.[0] };
}

async function callWfsBboxAroundCenter(lat: number, lng: number, delta: number) {
  const bbox = [lng - delta, lat - delta, lng + delta, lat + delta].join(",");
  const url = new URL(WFS);
  url.searchParams.set("key", KEY);
  url.searchParams.set("domain", DOMAIN);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("version", "2.0.0");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("typename", LAYER);
  url.searchParams.set("output", "application/json");
  url.searchParams.set("srsName", "EPSG:4326");
  url.searchParams.set("bbox", bbox);
  url.searchParams.set("maxFeatures", "100");
  const res = await fetch(url.toString(), {
    headers: { Referer: `https://${DOMAIN}` },
  });
  const data = (await res.json()) as any;
  return data.features ?? [];
}

async function searchAddress(query: string) {
  const url = new URL("https://api.vworld.kr/req/search");
  url.searchParams.set("service", "search");
  url.searchParams.set("request", "search");
  url.searchParams.set("version", "2.0");
  url.searchParams.set("crs", "EPSG:4326");
  url.searchParams.set("query", query);
  url.searchParams.set("type", "address");
  url.searchParams.set("category", "parcel");
  url.searchParams.set("format", "json");
  url.searchParams.set("errorformat", "json");
  url.searchParams.set("key", KEY);
  const res = await fetch(url.toString(), {
    headers: { Referer: `https://${DOMAIN}` },
  });
  return res.json();
}

async function run() {
  console.log("=".repeat(70));
  console.log("0) 산구분 0→1 보정 가설 검증 — 광주/강릉 케이스");
  console.log("=".repeat(70));
  const candidates = [
    { label: "광주 농성동 391-15", original: "2914010600003910015" },
    { label: "강릉 포남동 1067-33", original: "5115011100010670033" },
    { label: "성남 율동 산69-1", original: "4113510400100690001" },
    { label: "경산 신석리 산154", original: "4729037025101540000" },
  ];
  for (const c of candidates) {
    const fixed = c.original.charAt(10) === "0"
      ? c.original.slice(0, 10) + "1" + c.original.slice(11)
      : c.original;
    const r0 = await callWfsByPnu(c.original);
    const r1 = c.original !== fixed ? await callWfsByPnu(fixed) : null;
    console.log(`  ${c.label}`);
    console.log(`    원본 ${c.original} → features=${r0.features}`);
    if (r1) console.log(`    보정 ${fixed} → features=${r1.features}`);
  }

  console.log("\n" + "=".repeat(70));
  console.log("1) 캠코가 알려준 PNU 그대로 시도 (광주)");
  console.log("=".repeat(70));
  const original = "2914010600003910015";
  const r1 = await callWfsByPnu(original);
  console.log(`PNU=${original}  → features=${r1.features}`);

  console.log("\n" + "=".repeat(70));
  console.log("2) 본번/부번 변형 시도 (391, 391-15 다른 표기 가능성)");
  console.log("=".repeat(70));
  // PNU 19자리 = bjd(10) + 산구분(1) + 본번(4) + 부번(4)
  // 일반=1, 산=2
  // 캠코 PNU 분해: 2914010600 1 0391 0015
  const variants = [
    { label: "본번만(391)",       pnu: "2914010600100390000" },  // ← 본번 39 (잘못)
    { label: "본번만(391-0)",     pnu: "2914010600103910000" },
    { label: "원본(391-15)",      pnu: "2914010600103910015" },  // 산구분 1 강제
    { label: "원본 그대로",        pnu: original },
  ];
  for (const v of variants) {
    const r = await callWfsByPnu(v.pnu);
    console.log(`  ${v.label.padEnd(20)} ${v.pnu}  → features=${r.features}`);
  }

  console.log("\n" + "=".repeat(70));
  console.log("3) 한글주소로 VWorld 검색 API (PNU 역변환)");
  console.log("=".repeat(70));
  const queries = [
    "광주광역시 서구 농성동 391-15",
    "광주광역시 서구 농성동 391",
    "광주광역시 서구 농성동",
  ];
  for (const q of queries) {
    const r: any = await searchAddress(q);
    const items = r?.response?.result?.items ?? [];
    console.log(`\n  query="${q}"  status=${r?.response?.status}  items=${items.length}`);
    for (const it of items.slice(0, 3)) {
      console.log(`    address="${it.address?.parcel}"  id=${it.id}  point=${JSON.stringify(it.point)}`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("4) 캠코 매물 좌표(35.1542836642153, 126.889831848901) 주변 BBOX");
  console.log("=".repeat(70));
  const features = await callWfsBboxAroundCenter(35.1542836642153, 126.889831848901, 0.001);
  console.log(`  주변 ±0.001도 내 필지 수: ${features.length}`);
  for (const f of features.slice(0, 8)) {
    const p = f.properties;
    console.log(`    pnu=${p.pnu}  jibun=${p.jibun}  addr_dong=${p.ld_cd_nm ?? "?"}  area=${p.lndpcl_ar}㎡`);
  }
}

run().catch(console.error);
