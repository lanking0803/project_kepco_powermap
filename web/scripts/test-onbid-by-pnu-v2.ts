/**
 * /api/onbid/by-pnu 의 새 흐름 검증 (산구분 보정 적용 후).
 *
 * 입력 PNU 는 행안부 표준 (산구분 1=일반/2=산).
 * 매칭은 매물의 보정 PNU(pnuFromOnbidItem) 와 비교.
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
  const { fetchOnbidListPage, fetchOnbidDetail } = await import(
    "../lib/onbid/client"
  );
  const { enrichDetail, enrichRawItems } = await import("../lib/onbid/enrich");
  const { pnuFromOnbidItem } = await import("../lib/onbid/pnu-fix");
  const { createAdminClient } = await import("../lib/supabase/admin");

  const cases = [
    // 행안부 표준 PNU 입력 (산구분 1)
    { label: "광주 농성동 391-15 (다가구주택)", pnu: "2914010600103910015" },
    { label: "강릉 포남동 1067-33 (토지+건물)", pnu: "5115011100110670033" },
    { label: "성남 율동 산69-1 (임야)", pnu: "4113510400200690001" },
    { label: "(매물 없음 예상) 영암 시종면 봉소리 1번지", pnu: "4683034023100010000" },
  ];

  for (const tc of cases) {
    console.log("\n" + "=".repeat(80));
    console.log(`[${tc.label}]  PNU=${tc.pnu}`);
    console.log("=".repeat(80));

    const t0 = Date.now();
    const bjdCode = tc.pnu.slice(0, 10);

    // bjd_master
    const supabase = createAdminClient();
    const { data: bjdRow } = await supabase
      .from("bjd_master")
      .select("sep_1, sep_2, sep_3, sep_4")
      .eq("bjd_code", bjdCode)
      .maybeSingle();
    if (!bjdRow) {
      console.log(`  bjd_master 미수록`);
      continue;
    }
    const sigungu = [bjdRow.sep_2, bjdRow.sep_3].filter(Boolean).join(" ");
    console.log(
      `  bjd_master: ${bjdRow.sep_1} / ${sigungu} / ${bjdRow.sep_4}`,
    );

    // 캠코 목록
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
    console.log(`  목록: ${listRes.items.length}건`);

    // 보정 PNU 매칭
    const matchedAll = listRes.items.filter(
      (it) => pnuFromOnbidItem(it) === tc.pnu,
    );
    const dedupMap = new Map<string, (typeof matchedAll)[number]>();
    for (const it of matchedAll) {
      if (!dedupMap.has(it.cltrMngNo)) dedupMap.set(it.cltrMngNo, it);
    }
    const matched = [...dedupMap.values()];
    console.log(
      `  보정 PNU 일치: ${matchedAll.length}건 → dedup ${matched.length}건`,
    );

    if (matched.length === 0) {
      console.log(`  → 매물 없음 (${Date.now() - t0}ms)`);
      continue;
    }

    // 상세 병렬 + enrich
    const baseItemsP = enrichRawItems(matched);
    const detailsP = Promise.all(
      matched.map((m) => fetchOnbidDetail(m.cltrMngNo, m.pbctCdtnNo)),
    );
    const [baseItems, details] = await Promise.all([baseItemsP, detailsP]);
    const items = baseItems.map((b, i) =>
      enrichDetail(b, details[i] ?? matched[i]),
    );

    const dt = Date.now() - t0;
    const sample = items[0];
    console.log(`  ✅ 매물 ${items.length}건 enrich (${dt}ms)`);
    console.log(`     매물명: ${sample.onbidCltrNm}`);
    console.log(`     사진: ${sample.photoUrls.length}장 / 감정: ${sample.appraisals.length}건`);
  }
}

run().catch(console.error);
