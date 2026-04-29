/**
 * /api/onbid/search 의 핵심 로직 (client + enrich + categories) 직접 검증.
 *
 * 인증 미들웨어를 우회하기 위해 lib 함수만 직접 호출.
 * 실 API + 실 bjd_master JOIN 까지 모두 테스트.
 *
 * 실행:
 *   cd web && npx tsx scripts/test-onbid-search.ts
 */

// 스크립트 단독 실행 시 .env.local 수동 로드 (Next.js 외부에서 돌므로 자동 로드 안됨).
// dotenv 를 별도 설치하지 않고 직접 파싱 — 라인별 KEY=VALUE.
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
import { enrichRawItems } from "../lib/onbid/enrich";
import { ourCategoryToSclsParam } from "../lib/onbid/categories";
import type { OurCategory } from "../lib/onbid/types";

interface TestCase {
  label: string;
  params: Parameters<typeof fetchOnbidListPage>[0];
  postFilterCategories?: OurCategory[];
}

const cases: TestCase[] = [
  {
    label: "베이스라인 — 필터 없음 (전국)",
    params: {
      pageNo: 1,
      numOfRows: 5,
      prptDivCd: "0007",
      pvctTrgtYn: "N",
      cltrUsgLclsCtgrId: "10000",
    },
  },
  {
    label: "시도+시군구 — 전라남도 나주시",
    params: {
      pageNo: 1,
      numOfRows: 5,
      prptDivCd: "0007",
      pvctTrgtYn: "N",
      cltrUsgLclsCtgrId: "10000",
      lctnSdnm: "전라남도",
      lctnSggnm: "나주시",
    },
  },
  {
    label: "카테고리 — 창고 (단일 코드 10402)",
    params: {
      pageNo: 1,
      numOfRows: 5,
      prptDivCd: "0007",
      pvctTrgtYn: "N",
      cltrUsgLclsCtgrId: "10000",
      cltrUsgSclsCtgrId: ourCategoryToSclsParam("창고") ?? undefined,
    },
    postFilterCategories: ["창고"],
  },
  {
    label: "카테고리 — 토지 (사후필터)",
    params: {
      pageNo: 1,
      numOfRows: 30,
      prptDivCd: "0007",
      pvctTrgtYn: "N",
      cltrUsgLclsCtgrId: "10000",
    },
    postFilterCategories: ["토지"],
  },
  {
    label: "감정가 5천만 ~ 3억",
    params: {
      pageNo: 1,
      numOfRows: 5,
      prptDivCd: "0007",
      pvctTrgtYn: "N",
      cltrUsgLclsCtgrId: "10000",
      apslEvlAmtStart: 50_000_000,
      apslEvlAmtEnd: 300_000_000,
    },
  },
];

async function run() {
  for (const tc of cases) {
    console.log("\n" + "=".repeat(70));
    console.log(`[${tc.label}]`);
    console.log("=".repeat(70));
    try {
      const raw = await fetchOnbidListPage(tc.params);
      console.log(`  totalCount = ${raw.totalCount.toLocaleString()}건`);
      console.log(`  items 수신 = ${raw.items.length}건`);

      let items = await enrichRawItems(raw.items);
      if (tc.postFilterCategories && tc.postFilterCategories.length > 0) {
        const allow = new Set(tc.postFilterCategories);
        const before = items.length;
        items = items.filter((it) => it.ourCategory && allow.has(it.ourCategory));
        console.log(`  사후 카테고리 필터: ${before} → ${items.length}건`);
      }

      // 좌표 채움 통계
      const withCoord = items.filter((i) => i.lat != null && i.lng != null).length;
      console.log(
        `  좌표 채움 = ${withCoord}/${items.length} (${
          items.length > 0 ? Math.round((withCoord / items.length) * 100) : 0
        }%)`,
      );

      // 카테고리 분포
      const catCount = new Map<string, number>();
      for (const it of items) {
        const k = it.ourCategory ?? "(미분류)";
        catCount.set(k, (catCount.get(k) ?? 0) + 1);
      }
      const catLine = [...catCount.entries()]
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      console.log(`  카테고리 분포 = ${catLine || "(없음)"}`);

      // 샘플 1건
      const sample = items[0];
      if (sample) {
        console.log("  [샘플 1건]");
        console.log(`    cltrMngNo : ${sample.cltrMngNo}`);
        console.log(`    위치       : ${sample.lctnSdnm} ${sample.lctnSggnm} ${sample.lctnEmdNm}`);
        console.log(`    매물명     : ${sample.onbidCltrNm.slice(0, 50)}`);
        console.log(`    PNU        : ${sample.ltnoPnu}`);
        console.log(`    ourCategory: ${sample.ourCategory}`);
        console.log(`    sclsId/Nm  : ${sample.cltrUsgSclsCtgrId} (${sample.cltrUsgSclsCtgrNm})`);
        console.log(
          `    감정가     : ${sample.apslEvlAmt.toLocaleString()}원 → ${sample.lowstBidPrc.toLocaleString()}원 (${Math.round(
            sample.discountRatio * 100,
          )}% 할인)`,
        );
        console.log(`    D-day      : ${sample.daysLeft}${sample.isUrgent ? " ⚠임박" : ""}`);
        console.log(`    lat/lng    : ${sample.lat ?? "null"} / ${sample.lng ?? "null"}`);
        console.log(`    면적       : 토지 ${sample.landSqms ?? "-"}㎡ / 건물 ${sample.bldSqms ?? "-"}㎡`);
      }
    } catch (e) {
      console.error(`  [ERR] ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

run().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
