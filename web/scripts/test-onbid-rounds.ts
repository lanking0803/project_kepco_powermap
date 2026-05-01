/**
 * 같은 cltrMngNo 의 회차 row 응답 순서를 검증.
 *
 * 가설:
 *   - 첫 row 가 가장 최저가(=가장 미래 회차) 인지
 *   - 마지막 row 가 1차(=가장 비싸고 가장 임박한 회차) 인지
 *   - 또는 그 반대인지
 *
 * 실측 데이터 한 건만 보면 회차 순서 확정 가능.
 *
 * 실행:
 *   cd web && npx tsx scripts/test-onbid-rounds.ts
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
  // 스크린샷 조건 (울산 토지 카테고리) 으로 충분히 큰 페이지 받기
  const raw = await fetchOnbidListPage({
    pageNo: 1,
    numOfRows: 200,
    prptDivCd: "0007",
    pvctTrgtYn: "N",
    cltrUsgLclsCtgrId: "10000",
    lctnSdnm: "울산광역시",
  });
  console.log(`총 응답 row = ${raw.items.length}건 / totalCount = ${raw.totalCount}`);

  // cltrMngNo 별 그룹핑 (응답 순서 보존)
  const groups = new Map<string, typeof raw.items>();
  for (const it of raw.items) {
    const arr = groups.get(it.cltrMngNo);
    if (arr) arr.push(it);
    else groups.set(it.cltrMngNo, [it]);
  }

  // row 갯수 많은 매물 top 3 만 자세히 출력
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const topN = Math.min(3, sorted.length);

  for (let i = 0; i < topN; i++) {
    const [mngNo, rows] = sorted[i];
    console.log("\n" + "=".repeat(80));
    console.log(`[#${i + 1}] cltrMngNo=${mngNo}  rows=${rows.length}`);
    console.log(`매물명: ${rows[0].onbidCltrNm.slice(0, 60)}`);
    console.log(`감정가(공통 가정): ${rows[0].apslEvlAmt.toLocaleString()}원`);
    console.log("=".repeat(80));
    console.log(
      "응답순서 | pbctNo  | pbctCdtnNo | onbidCltrno | onbidPbancNo | 입찰종료      | 최저입찰가              | 유찰 | 할인%",
    );
    console.log("-".repeat(120));
    for (let r = 0; r < rows.length; r++) {
      const it = rows[r];
      const lowst = it.lowstBidPrcIndctCont.replace(/[^\d]/g, "");
      const lowstNum = lowst ? parseInt(lowst, 10) : 0;
      const apsl = Number(it.apslEvlAmt) || 0;
      const dPct =
        apsl > 0 ? Math.round((1 - lowstNum / apsl) * 100) : 0;
      console.log(
        `${String(r).padStart(8)} | ${String(it.pbctNo).padStart(7)} | ${String(it.pbctCdtnNo ?? "-").padStart(10)} | ${String(it.onbidCltrno).padStart(11)} | ${String(it.onbidPbancNo).padStart(12)} | ${it.cltrBidEndDt} | ${lowstNum.toLocaleString().padStart(15)} 원 | ${String(it.usbdNft ?? "-").padStart(4)} | ${String(dPct).padStart(4)}%`,
      );
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("회차 순서 진단 — 첫 row vs 마지막 row 의 입찰종료일/가격 비교");
  console.log("=".repeat(80));
  for (let i = 0; i < topN; i++) {
    const [mngNo, rows] = sorted[i];
    if (rows.length < 2) continue;
    const head = rows[0];
    const tail = rows[rows.length - 1];
    const headPrc = parseInt(head.lowstBidPrcIndctCont.replace(/[^\d]/g, "") || "0", 10);
    const tailPrc = parseInt(tail.lowstBidPrcIndctCont.replace(/[^\d]/g, "") || "0", 10);
    console.log(
      `[#${i + 1} ${mngNo}] 첫 row  종료=${head.cltrBidEndDt} pbctNo=${head.pbctNo} 가격=${headPrc.toLocaleString()}`,
    );
    console.log(
      `              마지막  종료=${tail.cltrBidEndDt} pbctNo=${tail.pbctNo} 가격=${tailPrc.toLocaleString()}`,
    );
    if (head.cltrBidEndDt < tail.cltrBidEndDt) {
      console.log(
        `   → 응답 순서 = 시간 정순 (첫 row 가 가장 가까운 회차, 마지막 row 가 가장 먼 미래)`,
      );
    } else if (head.cltrBidEndDt > tail.cltrBidEndDt) {
      console.log(
        `   → 응답 순서 = 시간 역순 (첫 row 가 가장 먼 미래, 마지막 row 가 가장 가까운 회차)`,
      );
    } else {
      console.log(`   → 입찰종료일 동일 (?)`);
    }
    console.log(
      `   가격 변동: ${headPrc > tailPrc ? "첫 row 가 더 비쌈 (마지막 row 가 더 싸짐)" : headPrc < tailPrc ? "첫 row 가 더 쌈 (마지막 row 가 더 비쌈)" : "동일"}`,
    );
  }
}

run().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
