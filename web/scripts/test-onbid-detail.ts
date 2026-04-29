/**
 * 캠코 상세 API getRlstDtlInf2 응답 구조 실측.
 *
 * 흐름:
 *   1. 목록에서 다양한 카테고리 매물 5~10건 cltrMngNo 수집
 *   2. 각 cltrMngNo 로 상세 호출
 *   3. 응답 필드 전부 출력 — 특히:
 *      - potoUrlList 구조 (배열? 객체? URL 직접 vs 중첩?)
 *      - lmapUrlAdrList (파이프 구분 문자열?)
 *      - papsInf 객체 내용
 *      - apslEvlClgList 구조
 *   4. pbctCdtnNo 안 줘도 호출 되는지 (필수 vs 선택 실측)
 */

import * as fs from "fs";
import * as path from "path";
{
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
}

const DETAIL_ENDPOINT =
  "https://apis.data.go.kr/B010003/OnbidRlstDtlSrvc2/getRlstDtlInf2";

import { fetchOnbidListPage } from "../lib/onbid/client";

interface DetailRequest {
  cltrMngNo: string;
  pbctCdtnNo?: number | null;
}

async function callDetail(req: DetailRequest): Promise<any> {
  const apiKey = process.env.DATA_GO_KR_KEY;
  if (!apiKey) throw new Error("DATA_GO_KR_KEY 미설정");

  const url = new URL(DETAIL_ENDPOINT);
  url.searchParams.set("serviceKey", apiKey);
  url.searchParams.set("resultType", "json");
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "10");
  url.searchParams.set("cltrMngNo", req.cltrMngNo);
  if (req.pbctCdtnNo != null) {
    url.searchParams.set("pbctCdtnNo", String(req.pbctCdtnNo));
  }

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text.trimStart().startsWith("{")) {
    throw new Error(`JSON 아님: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

async function pickSamples(): Promise<DetailRequest[]> {
  // 다양한 카테고리 매물 수집 — 100건에서 sclsId 다양하게
  const list = await fetchOnbidListPage({
    pageNo: 1,
    numOfRows: 100,
    prptDivCd: "0007",
    pvctTrgtYn: "N",
    cltrUsgLclsCtgrId: "10000",
  });
  const seen = new Set<string>();
  const samples: DetailRequest[] = [];
  for (const it of list.items) {
    const k = it.cltrUsgSclsCtgrId ?? "?";
    if (seen.has(k)) continue;
    seen.add(k);
    samples.push({ cltrMngNo: it.cltrMngNo, pbctCdtnNo: it.pbctCdtnNo });
    if (samples.length >= 5) break;
  }
  return samples;
}

function printDeep(label: string, obj: unknown, depth = 0): void {
  const pad = "  ".repeat(depth);
  if (obj === null || obj === undefined) {
    console.log(`${pad}${label}: ${obj}`);
    return;
  }
  if (Array.isArray(obj)) {
    console.log(`${pad}${label}: [배열 ${obj.length}건]`);
    if (obj.length > 0) {
      printDeep("[0]", obj[0], depth + 1);
      if (obj.length > 1) console.log(`${pad}  ...`);
    }
    return;
  }
  if (typeof obj === "object") {
    console.log(`${pad}${label}: {`);
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      printDeep(k, v, depth + 1);
    }
    console.log(`${pad}}`);
    return;
  }
  // 원시값 — 너무 길면 자르기
  let s = String(obj);
  if (s.length > 120) s = s.slice(0, 120) + "...";
  console.log(`${pad}${label}: ${s}`);
}

async function run() {
  console.log("1) 목록에서 샘플 cltrMngNo 수집 중...");
  const samples = await pickSamples();
  console.log(`   ${samples.length}건 수집:`, samples.map((s) => s.cltrMngNo).join(", "));

  // 1번 케이스: pbctCdtnNo 포함 호출
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    console.log("\n" + "=".repeat(80));
    console.log(`[샘플 ${i + 1}/${samples.length}] cltrMngNo=${s.cltrMngNo}  pbctCdtnNo=${s.pbctCdtnNo ?? "(생략)"}`);
    console.log("=".repeat(80));
    try {
      const json = await callDetail(s);
      const code = json?.header?.resultCode;
      console.log(`resultCode = ${code}  msg = ${json?.header?.resultMsg}`);
      if (code !== "00") {
        console.log(`  [skip] resultCode != 00`);
        continue;
      }
      const items = json?.body?.items;
      let item: any = null;
      if (Array.isArray(items?.item)) item = items.item[0];
      else if (items?.item) item = items.item;

      if (!item) {
        console.log("  [empty] item 없음");
        continue;
      }

      // 핵심 필드 출력
      console.log("\n--- 핵심 필드 ---");
      printDeep("cltrMngNo", item.cltrMngNo);
      printDeep("onbidCltrNm", item.onbidCltrNm);
      printDeep("cltrRadr", item.cltrRadr);
      printDeep("cltrEtcCont", item.cltrEtcCont);
      printDeep("ltnoPnu", item.ltnoPnu);
      printDeep("rdnmPnu", item.rdnmPnu);
      printDeep("apslEvlAmt", item.apslEvlAmt);
      printDeep("lowstBidPrcIndctCont", item.lowstBidPrcIndctCont);
      printDeep("usbdNft", item.usbdNft);

      console.log("\n--- 사진/위치도 ---");
      printDeep("potoUrlList", item.potoUrlList);
      printDeep("lmapUrlAdrList", item.lmapUrlAdrList);
      printDeep("thnlImgUrlAdr", item.thnlImgUrlAdr);

      console.log("\n--- 감정평가 / 공매재산명세 ---");
      printDeep("apslEvlClgList", item.apslEvlClgList);
      printDeep("papsInf", item.papsInf);

      console.log("\n--- 응답에 등장한 모든 키 (디버깅용) ---");
      console.log(Object.keys(item).join(", "));
    } catch (e) {
      console.log(`  [ERR] ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2번 케이스: pbctCdtnNo 없이 호출 (필수 여부 실측)
  if (samples[0]) {
    console.log("\n" + "=".repeat(80));
    console.log("[추가] pbctCdtnNo 생략 호출 — 필수 여부 검증");
    console.log("=".repeat(80));
    try {
      const json = await callDetail({ cltrMngNo: samples[0].cltrMngNo });
      const code = json?.header?.resultCode;
      console.log(`resultCode = ${code}  msg = ${json?.header?.resultMsg}`);
      const item = Array.isArray(json?.body?.items?.item)
        ? json.body.items.item[0]
        : json?.body?.items?.item;
      console.log(`item 수신 여부 = ${item ? "OK" : "비어있음"}`);
      if (item) {
        console.log(`item.cltrMngNo = ${item.cltrMngNo}`);
      }
    } catch (e) {
      console.log(`  [ERR] ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

run().catch(console.error);
