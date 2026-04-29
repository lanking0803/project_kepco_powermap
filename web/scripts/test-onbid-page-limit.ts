/**
 * 캠코 numOfRows 실제 한도 측정 — 100 / 500 / 1000 / 5000 호출.
 * 응답 시간 + 실제 받은 건수 + 에러 여부 보고.
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

const sizes = [100, 500, 1000, 2000, 5000];

async function run() {
  for (const n of sizes) {
    const t0 = Date.now();
    try {
      const res = await fetchOnbidListPage({
        pageNo: 1,
        numOfRows: n,
        prptDivCd: "0007",
        pvctTrgtYn: "N",
        cltrUsgLclsCtgrId: "10000",
      });
      const dt = Date.now() - t0;
      console.log(
        `numOfRows=${n.toString().padStart(5)}: 받은 ${res.items.length.toString().padStart(5)}건  total=${res.totalCount.toLocaleString()}  ${dt}ms`,
      );
    } catch (e) {
      const dt = Date.now() - t0;
      console.log(
        `numOfRows=${n.toString().padStart(5)}: [ERR] ${e instanceof Error ? e.message : e}  ${dt}ms`,
      );
    }
  }
}

run();
