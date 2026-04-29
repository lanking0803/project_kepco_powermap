/**
 * /api/onbid/by-pnu 의 핵심 로직(엔드포인트의 내부 동작) 직접 검증.
 *
 * 인증 우회 위해 lib 함수만 호출.
 * 실제 응답 구조 + 매칭 정확도 + 외부 호출 횟수 확인.
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

import {
  fetchOnbidListPage,
  fetchOnbidDetail,
} from "../lib/onbid/client";
import { enrichDetail, enrichRawItems } from "../lib/onbid/enrich";
import { createAdminClient } from "../lib/supabase/admin";

interface TestCase {
  label: string;
  pnu: string;
}

const cases: TestCase[] = [
  // 검증된 매물(crawler 테스트 + 우리 검증에서 등장한 것들)
  { label: "광주 농성동 391-15 (다가구주택)", pnu: "2914010600003910015" },
  { label: "강릉 포남동 1067-33 (근린생활시설)", pnu: "5115011100010670033" },
  { label: "성남 율동 산69-1 (임야)", pnu: "4113510400100690001" },
  // 매칭 실패 예상(매물 없는 일반 필지)
  { label: "(예상 미스) 영암 시종면 봉소리 1번지", pnu: "4683034023000010000" },
];

async function processOnePnu(pnu: string) {
  const t0 = Date.now();
  if (!/^\d{19}$/.test(pnu)) {
    console.log(`  [ERR] PNU 형식 오류`);
    return;
  }
  const bjdCode = pnu.slice(0, 10);

  // 1) bjd_master
  const supabase = createAdminClient();
  const { data: bjdRow } = await supabase
    .from("bjd_master")
    .select("sep_1, sep_2, sep_3, sep_4, sep_5")
    .eq("bjd_code", bjdCode)
    .maybeSingle();
  if (!bjdRow) {
    console.log(`  bjd_master 미수록 → items=[]`);
    return;
  }
  console.log(
    `  bjd_master: ${bjdRow.sep_1} / ${[bjdRow.sep_2, bjdRow.sep_3].filter(Boolean).join(" ")} / ${bjdRow.sep_4 ?? ""}`,
  );

  // 2) 목록 호출
  const sigungu = [bjdRow.sep_2, bjdRow.sep_3].filter(Boolean).join(" ");
  const listRes = await fetchOnbidListPage({
    pageNo: 1,
    numOfRows: 200,
    prptDivCd: "0007",
    pvctTrgtYn: "N",
    cltrUsgLclsCtgrId: "10000",
    lctnSdnm: bjdRow.sep_1 ?? undefined,
    lctnSggnm: sigungu || undefined,
    lctnEmdNm: bjdRow.sep_4 ?? undefined,
  });
  const dt1 = Date.now() - t0;
  console.log(
    `  목록(${dt1}ms): ${listRes.items.length}건 / 동 전체 ${listRes.totalCount}건`,
  );

  // 3) ltnoPnu 필터 + cltrMngNo dedup (회차 중복 제거)
  const matchedAll = listRes.items.filter((it) => it.ltnoPnu === pnu);
  const dedupMap = new Map<string, (typeof matchedAll)[number]>();
  for (const it of matchedAll) {
    if (!dedupMap.has(it.cltrMngNo)) dedupMap.set(it.cltrMngNo, it);
  }
  const matched = [...dedupMap.values()];
  console.log(
    `  ltnoPnu 일치: ${matchedAll.length}건 → dedup 후 ${matched.length}건 (회차 중복 제거)`,
  );

  if (matched.length === 0) return;

  // 4) 상세 병렬
  const t2 = Date.now();
  const baseItems = await enrichRawItems(matched);
  const details = await Promise.all(
    matched.map((m) => fetchOnbidDetail(m.cltrMngNo, m.pbctCdtnNo)),
  );
  const items = baseItems.map((base, i) =>
    enrichDetail(base, details[i] ?? matched[i]),
  );
  const dt2 = Date.now() - t2;
  console.log(`  상세(${dt2}ms): ${items.length}건 enrich 완료`);

  // 5) 첫 매물 상세 출력
  const sample = items[0];
  console.log("\n  [샘플 매물]");
  console.log(`    cltrMngNo  : ${sample.cltrMngNo}`);
  console.log(`    매물명     : ${sample.onbidCltrNm}`);
  console.log(`    카테고리   : ${sample.ourCategory}`);
  console.log(`    감정가     : ${sample.apslEvlAmt.toLocaleString()}`);
  console.log(`    최저입찰가 : ${sample.lowstBidPrc.toLocaleString()} (${Math.round(sample.discountRatio * 100)}% 할인)`);
  console.log(`    D-day      : ${sample.daysLeft}`);
  console.log(`    좌표       : ${sample.lat ?? "null"}, ${sample.lng ?? "null"}`);
  console.log(`    도로명     : ${sample.cltrRadr ?? "(없음)"}`);
  console.log(`    📷 사진    : ${sample.photoUrls.length}장`);
  console.log(`    📷 360도   : ${sample.photo360Urls.length}장`);
  console.log(`    📹 영상    : ${sample.videoUrls.length}건`);
  console.log(`    🗺  위치도  : ${sample.locationMapUrls.length}건`);
  console.log(`    📋 감정평가: ${sample.appraisals.length}건`);
  if (sample.appraisals[0]) {
    const a = sample.appraisals[0];
    console.log(`       └ ${a.date} ${a.org} ${a.amount.toLocaleString()}원 PDF=${a.pdfUrl ? "있음" : "없음"}`);
  }
  if (sample.locVntyPscdCont) console.log(`    위치/접근성: ${sample.locVntyPscdCont.slice(0, 80)}`);
  if (sample.utlzPscdCont) console.log(`    활용/이용  : ${sample.utlzPscdCont.slice(0, 80)}`);
  if (sample.icdlCdtnCont) console.log(`    입찰조건   : ${sample.icdlCdtnCont.slice(0, 80)}`);
  if (sample.purrQlfcCont) console.log(`    매수자격   : ${sample.purrQlfcCont.slice(0, 80)}`);
  if (sample.pytnMtrsCont) console.log(`    납부사항   : ${sample.pytnMtrsCont.slice(0, 80)}`);

  const totalDt = Date.now() - t0;
  console.log(`\n  ⏱ 전체 ${totalDt}ms (외부 호출 1+${matched.length} = ${1 + matched.length}회)`);
}

async function run() {
  for (const tc of cases) {
    console.log("\n" + "=".repeat(80));
    console.log(`[${tc.label}]  PNU=${tc.pnu}`);
    console.log("=".repeat(80));
    try {
      await processOnePnu(tc.pnu);
    } catch (e) {
      console.log(`  [ERR] ${e instanceof Error ? e.message : e}`);
    }
  }
}

run().catch(console.error);
