/**
 * 의뢰자 보고된 모든 오류 케이스의 새 enrich 결과 확인.
 *
 * 1. 봉계리 산1 — 유찰 4회 + 응답 row 2 → 회차 5/6 이어야 함 (5/2 모순 해결)
 * 2. 봉전리 산123-3 — 응답 row 9, 유찰 0 → 회차 1/9 + D-47
 * 3. 양덕리 1484-3 — 응답 row 10, 유찰 0 → 회차 1/10 + D-54
 * 4. 연호리 산77 — 응답 row 10, 유찰 6 → 회차 7/16 + D-26
 */
import * as fs from "fs";
import * as path from "path";
{
  const envPath = path.resolve(__dirname, "../.env.local");
  if (fs.existsSync(envPath)) {
    const text = fs.readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

import { fetchOnbidListPage } from "../lib/onbid/client";
import { enrichRawItems } from "../lib/onbid/enrich";

interface Case {
  label: string;
  sd: string;
  sgg: string;
  emd: string;
  filter: string;
}

const cases: Case[] = [
  { label: "봉계리 산1 (유찰 4회 케이스 = 5/2 모순)", sd: "울산광역시", sgg: "울주군", emd: "두동면", filter: "봉계리 산1" },
  { label: "봉전리 산123-3 (응답 9 row)", sd: "전라남도", sgg: "여수시", emd: "율촌면", filter: "봉전리 산123-3" },
  { label: "양덕리 1484-3 (응답 10 row)", sd: "전라남도", sgg: "영광군", emd: "군남면", filter: "양덕리 1484-3" },
  { label: "연호리 산77 (유찰 6회)", sd: "전라남도", sgg: "해남군", emd: "황산면", filter: "연호리 산77" },
];

async function run() {
  for (const tc of cases) {
    console.log(`\n${"=".repeat(80)}\n[${tc.label}]\n${"=".repeat(80)}`);
    const raw = await fetchOnbidListPage({
      pageNo: 1, numOfRows: 200,
      prptDivCd: "0007", pvctTrgtYn: "N",
      cltrUsgLclsCtgrId: "10000",
      lctnSdnm: tc.sd, lctnSggnm: tc.sgg, lctnEmdNm: tc.emd,
    });
    const matched = raw.items.filter((it) => it.onbidCltrNm.includes(tc.filter));
    console.log(`raw row = ${matched.length}, 유찰 = ${matched[0]?.usbdNft ?? "-"}`);
    const items = await enrichRawItems(matched);
    for (const it of items) {
      console.log(
        `  ✓ D-${it.daysLeft} ${it.lowstBidPrc.toLocaleString()}원 (${Math.round(it.discountRatio * 100)}%↓) ` +
        `회차 ${it.roundCurrent}/${it.roundTotal} 유찰=${it.usbdNft} ` +
        `최저시=${it.minRoundPrice?.toLocaleString() ?? "-"}원`,
      );
    }
  }
}
run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
