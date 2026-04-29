/**
 * bjd_master 한글주소 ↔ 캠코 응답 매칭 검증.
 *
 * 흐름:
 *   1. 캠코 목록 API 베이스라인 (numOfRows=500) 호출
 *   2. 응답 매물의 ltnoPnu 앞 10자리(=bjd_code) 추출
 *   3. bjd_master 에서 그 bjd_code 의 sep_1~5 조회
 *   4. 두 출처 비교:
 *      - 캠코: lctnSdnm / lctnSggnm / lctnEmdNm
 *      - DB:    sep_1   / sep_2~3 / sep_4(읍면동) / sep_5(리)
 *   5. 미스매치 케이스 모두 출력 + 미스매치율 통계
 *
 * 목적:
 *   - 강원도 vs 강원특별자치도, 광역시 자치구 체계 등 차이 발견
 *   - 보정 규칙 필요 여부 판단
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

import { fetchOnbidListPage } from "../lib/onbid/client";
import { createAdminClient } from "../lib/supabase/admin";

interface Mismatch {
  bjdCode: string;
  pnu: string;
  cltrNm: string;
  // 캠코 응답
  onbidSd: string;
  onbidSgg: string;
  onbidEmd: string;
  // bjd_master
  dbSep1: string;
  dbSep2: string | null;
  dbSep3: string | null;
  dbSep4: string | null;
  dbSep5: string | null;
  reason: string;
}

async function run() {
  console.log("1) 캠코 목록 API 호출 (500건 샘플)...");
  const res = await fetchOnbidListPage({
    pageNo: 1,
    numOfRows: 500,
    prptDivCd: "0007",
    pvctTrgtYn: "N",
    cltrUsgLclsCtgrId: "10000",
  });
  console.log(`   받은 매물: ${res.items.length}건 / 전체 ${res.totalCount.toLocaleString()}건`);

  // ltnoPnu 19자리 유효 매물만 + 시도/시군구/읍면동 다양성 확보 위해 unique bjd 수집
  const seen = new Set<string>();
  const samples: typeof res.items = [];
  for (const it of res.items) {
    const pnu = (it.ltnoPnu ?? "").trim();
    if (!/^\d{19}$/.test(pnu)) continue;
    const bjd = pnu.slice(0, 10);
    if (seen.has(bjd)) continue;
    seen.add(bjd);
    samples.push(it);
  }
  console.log(`   고유 bjd_code: ${samples.length}개\n`);

  // bjd_master 일괄 조회
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("bjd_master")
    .select("bjd_code, sep_1, sep_2, sep_3, sep_4, sep_5")
    .in("bjd_code", Array.from(seen));
  if (error) {
    console.error("bjd_master 조회 실패:", error);
    return;
  }
  const bjdMap = new Map<string, {
    sep_1: string;
    sep_2: string | null;
    sep_3: string | null;
    sep_4: string | null;
    sep_5: string | null;
  }>();
  for (const row of data ?? []) {
    bjdMap.set(row.bjd_code, row);
  }
  console.log(`2) bjd_master 매칭: ${bjdMap.size}/${seen.size}\n`);

  // 비교
  const mismatches: Mismatch[] = [];
  let bjdMissing = 0;
  let exactMatch = 0;
  let sdMismatch = 0;
  let sggMismatch = 0;
  let emdMismatch = 0;

  for (const it of samples) {
    const bjd = it.ltnoPnu.slice(0, 10);
    const db = bjdMap.get(bjd);
    if (!db) {
      bjdMissing++;
      continue;
    }

    // 캠코 sgg = "광산구" 또는 "고양시 일산동구" (조합)
    // DB 는 sep_2 (시), sep_3 (구). 조합해서 비교.
    const dbSgg = [db.sep_2, db.sep_3].filter(Boolean).join(" ");

    // 캠코 emd 는 행정동/법정동. DB 는 sep_4 (읍면동) + sep_5 (리). 캠코는 동까지만.
    const dbEmd = db.sep_4 ?? "";

    let reason = "";
    if (it.lctnSdnm !== db.sep_1) {
      sdMismatch++;
      reason += `시도(${it.lctnSdnm}≠${db.sep_1}) `;
    }
    if (it.lctnSggnm !== dbSgg) {
      sggMismatch++;
      reason += `시군구(${it.lctnSggnm}≠${dbSgg}) `;
    }
    if (it.lctnEmdNm !== dbEmd) {
      emdMismatch++;
      reason += `읍면동(${it.lctnEmdNm}≠${dbEmd}) `;
    }

    if (reason) {
      mismatches.push({
        bjdCode: bjd,
        pnu: it.ltnoPnu,
        cltrNm: it.onbidCltrNm.slice(0, 40),
        onbidSd: it.lctnSdnm,
        onbidSgg: it.lctnSggnm,
        onbidEmd: it.lctnEmdNm,
        dbSep1: db.sep_1,
        dbSep2: db.sep_2,
        dbSep3: db.sep_3,
        dbSep4: db.sep_4,
        dbSep5: db.sep_5,
        reason: reason.trim(),
      });
    } else {
      exactMatch++;
    }
  }

  console.log("=".repeat(70));
  console.log("결과 통계");
  console.log("=".repeat(70));
  const total = samples.length;
  console.log(`총 검사 bjd_code     : ${total}`);
  console.log(`  └ 완전 일치         : ${exactMatch} (${pct(exactMatch, total)}%)`);
  console.log(`  └ bjd_master 미수록 : ${bjdMissing} (${pct(bjdMissing, total)}%)`);
  console.log(`  └ 일부 불일치       : ${mismatches.length} (${pct(mismatches.length, total)}%)`);
  console.log(`     · 시도 불일치   : ${sdMismatch}`);
  console.log(`     · 시군구 불일치 : ${sggMismatch}`);
  console.log(`     · 읍면동 불일치 : ${emdMismatch}`);

  console.log("\n" + "=".repeat(70));
  console.log("미스매치 사례 (최대 30개)");
  console.log("=".repeat(70));
  for (const m of mismatches.slice(0, 30)) {
    console.log(`\n[bjd ${m.bjdCode}] ${m.cltrNm}`);
    console.log(`  캠코: ${m.onbidSd} / ${m.onbidSgg} / ${m.onbidEmd}`);
    console.log(`  DB  : ${m.dbSep1} / ${[m.dbSep2, m.dbSep3].filter(Boolean).join(" ")} / ${m.dbSep4 ?? ""}`);
    console.log(`  → ${m.reason}`);
  }

  // 시도별 미스매치 패턴 (강원도 → 강원특별자치도 같은 시스템적 차이 잡기)
  console.log("\n" + "=".repeat(70));
  console.log("시도 미스매치 매핑 (캠코 → DB)");
  console.log("=".repeat(70));
  const sdPair = new Map<string, number>();
  for (const m of mismatches) {
    if (m.onbidSd !== m.dbSep1) {
      const k = `${m.onbidSd}  →  ${m.dbSep1}`;
      sdPair.set(k, (sdPair.get(k) ?? 0) + 1);
    }
  }
  if (sdPair.size === 0) console.log("(없음)");
  for (const [k, v] of sdPair) console.log(`  ${k}  (${v}건)`);
}

function pct(a: number, b: number): string {
  return b > 0 ? ((a / b) * 100).toFixed(1) : "0.0";
}

run().catch(console.error);
