/**
 * 캠코 응답에 등장하는 cltrUsgSclsCtgrId 코드 분포 수집.
 *
 * 캠코 코드표가 공개돼있지 않아 직접 호출해서 실측.
 * 100건 샘플 → 코드별 (이름, 등장횟수) 정렬 출력.
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

async function run() {
  const counts = new Map<string, { name: string; count: number; samples: string[] }>();
  let scanned = 0;

  // 3 페이지 × 100건 = 300건 샘플
  for (let p = 1; p <= 3; p++) {
    const res = await fetchOnbidListPage({
      pageNo: p,
      numOfRows: 100,
      prptDivCd: "0007",
      pvctTrgtYn: "N",
      cltrUsgLclsCtgrId: "10000",
    });
    scanned += res.items.length;
    for (const it of res.items) {
      const id = it.cltrUsgSclsCtgrId ?? "(빈값)";
      const name = it.cltrUsgSclsCtgrNm ?? "";
      const e = counts.get(id);
      if (e) {
        e.count += 1;
        if (e.samples.length < 2) e.samples.push(it.onbidCltrNm.slice(0, 50));
      } else {
        counts.set(id, {
          name,
          count: 1,
          samples: [it.onbidCltrNm.slice(0, 50)],
        });
      }
    }
    if (res.items.length < 100) break; // 마지막 페이지
  }

  console.log(`스캔 완료: ${scanned}건`);
  console.log(`\n${"코드".padEnd(8)} ${"이름".padEnd(20)} 건수`);
  console.log("=".repeat(50));
  const sorted = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [id, info] of sorted) {
    console.log(`${id.padEnd(8)} ${info.name.padEnd(22)} ${info.count}건`);
    for (const s of info.samples) console.log(`           └ ${s}`);
  }
}

run().catch(console.error);
