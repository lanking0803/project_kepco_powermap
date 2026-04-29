/**
 * 캠코 ltnoPnu 의 산구분(11번째 자리) 분포 + VWorld 매칭률 측정.
 *
 * 가설: 캠코 PNU 의 산구분이 일부 0 (비표준) 으로 채워짐.
 *
 * 흐름:
 *   1. 캠코 목록 500건 샘플
 *   2. ltnoPnu 분해 → 산구분 분포 (0/1/2)
 *   3. 각각 VWorld 매칭률 측정 (작은 샘플)
 *   4. 0→1 보정 시 매칭 회복률 측정
 *   5. 매물명에서 지번 추출 → buildPnuFromBjdAndJibun 으로 재구성 → 매칭률 (대안 검증)
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

async function run() {
  const { fetchOnbidListPage } = await import("../lib/onbid/client");
  const { getParcelByPnu } = await import("../lib/vworld/parcel");
  const { buildPnuFromBjdAndJibun } = await import("../lib/geo/pnu");

  console.log("1) 캠코 목록 500건 샘플 수집...");
  const list = await fetchOnbidListPage({
    pageNo: 1,
    numOfRows: 500,
    prptDivCd: "0007",
    pvctTrgtYn: "N",
    cltrUsgLclsCtgrId: "10000",
  });
  // cltrMngNo dedup (회차 중복 제거)
  const dedup = new Map<string, (typeof list.items)[number]>();
  for (const it of list.items) {
    if (!dedup.has(it.cltrMngNo)) dedup.set(it.cltrMngNo, it);
  }
  const items = [...dedup.values()];
  console.log(`   dedup 후 ${items.length}건 매물 (전체 ${list.totalCount.toLocaleString()})`);

  // 2) 산구분 분포
  console.log("\n2) PNU 11번째 자리(산구분) 분포");
  const dist = new Map<string, number>();
  const samples: Record<string, (typeof items)[number][]> = {};
  for (const it of items) {
    const pnu = it.ltnoPnu ?? "";
    if (!/^\d{19}$/.test(pnu)) {
      dist.set("(형식오류)", (dist.get("(형식오류)") ?? 0) + 1);
      continue;
    }
    const san = pnu.charAt(10);
    dist.set(san, (dist.get(san) ?? 0) + 1);
    if (!samples[san]) samples[san] = [];
    if (samples[san].length < 5) samples[san].push(it);
  }
  for (const [k, v] of dist) {
    console.log(`   산구분 "${k}": ${v}건 (${((v / items.length) * 100).toFixed(1)}%)`);
  }

  // 각 분류 샘플 매물명
  for (const [san, arr] of Object.entries(samples)) {
    console.log(`\n   [산구분 ${san} 샘플]`);
    for (const s of arr) {
      console.log(`     ${s.ltnoPnu}  ${s.onbidCltrNm.slice(0, 60)}`);
    }
  }

  // 3) 산구분별 VWorld 매칭률 (각 분류 최대 10건 샘플)
  console.log("\n" + "=".repeat(70));
  console.log("3) 산구분별 VWorld 매칭률 (각 최대 10건)");
  console.log("=".repeat(70));

  for (const [san, arr] of Object.entries(samples)) {
    const tested = arr.slice(0, 10);
    let okOriginal = 0;
    let okFixed = 0;
    let okRebuilt = 0;
    for (const it of tested) {
      const original = it.ltnoPnu;
      // 산구분 보정 (0→1)
      const fixed =
        original.charAt(10) === "0"
          ? original.slice(0, 10) + "1" + original.slice(11)
          : original;

      // buildPnuFromBjdAndJibun 재구성: 매물명에서 지번 추출 시도
      // "광주광역시 서구 농성동 391-15  (토지),  9 (토지, 건물)" → 첫 지번
      const bjd = original.slice(0, 10);
      const jibunMatch = it.onbidCltrNm.match(/(산?\d+(?:-\d+)?)/);
      const extractedJibun = jibunMatch?.[1] ?? null;
      const rebuilt = extractedJibun
        ? buildPnuFromBjdAndJibun(bjd, extractedJibun)
        : null;

      const r1 = await getParcelByPnu(original);
      if (r1) okOriginal++;
      if (fixed !== original) {
        const r2 = await getParcelByPnu(fixed);
        if (r2) okFixed++;
      }
      if (rebuilt && rebuilt !== original) {
        const r3 = await getParcelByPnu(rebuilt);
        if (r3) okRebuilt++;
      }
    }
    const n = tested.length;
    console.log(
      `\n  산구분 "${san}" (${n}건 테스트):`,
    );
    console.log(`    - 원본 그대로     : ${okOriginal}/${n} (${pct(okOriginal, n)}%)`);
    if (san === "0") {
      console.log(`    - 보정(0→1)       : ${okFixed}/${n} (${pct(okFixed, n)}%)`);
    }
    console.log(`    - 매물명 재구성    : ${okRebuilt}/${n} (${pct(okRebuilt, n)}%)`);
  }
}

function pct(a: number, b: number): string {
  return b > 0 ? ((a / b) * 100).toFixed(0) : "0";
}

run().catch(console.error);
