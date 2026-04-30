#!/usr/bin/env node
// 일회용 벤치 스크립트 — search_kepco 재설계 검증.
// 사용법: PAT="sbp_..." node web/scripts/bench-search-redesign.mjs
// 또는: node web/scripts/bench-search-redesign.mjs <PAT>

const PROJECT_REF = "wtbwgjejfrrwgbzgcdjd";
const PAT = process.env.PAT || process.argv[2];
if (!PAT) {
  console.error("PAT 필요. PAT=sbp_... node web/scripts/bench-search-redesign.mjs");
  process.exit(1);
}

const ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

async function runSql(query) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function explain(label, sql, opts = {}) {
  const { showRows = 0 } = opts;
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`▶ ${label}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  try {
    const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`;
    const t0 = Date.now();
    const result = await runSql(explainSql);
    const elapsed = Date.now() - t0;
    const plan = result[0]?.["QUERY PLAN"]?.[0];
    if (!plan) {
      console.log("plan 없음:", JSON.stringify(result).slice(0, 500));
      return;
    }
    console.log(`Execution Time: ${plan["Execution Time"]?.toFixed(2)} ms (HTTP RTT 포함 ${elapsed}ms)`);
    console.log(`Planning Time: ${plan["Planning Time"]?.toFixed(2)} ms`);
    const top = plan.Plan;
    console.log(`Top node: ${top["Node Type"]}${top["Index Name"] ? " on " + top["Index Name"] : ""}`);
    console.log(`Rows actual: ${top["Actual Rows"]} / loops: ${top["Actual Loops"]}`);
    if (top["Rows Removed by Filter"]) {
      console.log(`Rows Removed by Filter: ${top["Rows Removed by Filter"]}`);
    }
    if (showRows > 0) {
      const rows = await runSql(sql);
      console.log(`결과 ${rows.length}건 (head ${Math.min(showRows, rows.length)}):`);
      console.log(JSON.stringify(rows.slice(0, showRows), null, 2));
    }
  } catch (e) {
    console.log("ERROR:", e.message.slice(0, 800));
  }
}

async function main() {
  console.log("# search_kepco 재설계 벤치마크\n");

  // ──────────────────────────────
  // 0. 케이스용 bjd_code 확정
  // ──────────────────────────────
  console.log("\n## 0. 케이스 bjd_code 확정");
  const bjdSamples = await runSql(`
    SELECT b.bjd_code, b.sep_1, b.sep_3, b.sep_4, b.sep_5,
           (SELECT COUNT(*) FROM kepco_capa c WHERE c.bjd_code = b.bjd_code) AS rows_in_capa
    FROM bjd_master b
    WHERE (b.sep_4 = '장암면' AND b.sep_5 = '지토리')
       OR (b.sep_5 = '직리')
    ORDER BY rows_in_capa DESC
    LIMIT 20;
  `);
  console.log(JSON.stringify(bjdSamples, null, 2));

  // 지토리 bjd_code 추출
  const jitoRow = bjdSamples.find(
    (r) => r.sep_4 === "장암면" && r.sep_5 === "지토리"
  );
  const jikRiRows = bjdSamples.filter((r) => r.sep_5 === "직리");

  if (!jitoRow) {
    console.log("⚠️ 지토리 못 찾음 — 다른 케이스로 대체");
  } else {
    console.log(`✅ 지토리 bjd_code = ${jitoRow.bjd_code} (kepco_capa rows: ${jitoRow.rows_in_capa})`);
  }
  console.log(`✅ 직리 bjd_code 후보 ${jikRiRows.length}개`);

  // ──────────────────────────────
  // A. 시나리오: "충남 부여군 장암면 지토리 29-4"
  // ──────────────────────────────
  if (jitoRow) {
    const bjd = jitoRow.bjd_code;

    await explain(
      `[새 구조 1단계] bjd_master ILIKE — "충남 부여군 장암면 지토리"`,
      `SELECT b.bjd_code, b.sep_1, b.sep_3, b.sep_4, b.sep_5
       FROM bjd_master b
       WHERE COALESCE(b.sep_1,'') ILIKE '%충남%'
         AND COALESCE(b.sep_3,'') ILIKE '%부여군%'
         AND COALESCE(b.sep_4,'') ILIKE '%장암면%'
         AND COALESCE(b.sep_5,'') ILIKE '%지토리%'
       LIMIT 20`
    );

    await explain(
      `[새 구조 1단계] "지토리"만 (광범위)`,
      `SELECT b.bjd_code, b.sep_1, b.sep_3, b.sep_4, b.sep_5
       FROM bjd_master b
       WHERE COALESCE(b.sep_5,'') ILIKE '%지토리%'
       LIMIT 20`
    );

    await explain(
      `[새 구조 2단계] kepco_capa 정확매칭 — bjd_code='${bjd}' AND main=29`,
      `SELECT c.id, c.bjd_code, c.addr_jibun
       FROM kepco_capa c
       WHERE c.bjd_code = '${bjd}'
         AND kepco_jibun_main(c.addr_jibun) = 29
       LIMIT 10`
    );

    await explain(
      `[새 구조 2단계] kepco_capa 폴백 — bjd 1개 안에서 lower5/upper5 (main=29)`,
      `WITH lower5 AS (
         SELECT c.id, c.addr_jibun, kepco_jibun_main(c.addr_jibun) AS main
         FROM kepco_capa c
         WHERE c.bjd_code = '${bjd}'
           AND kepco_jibun_main(c.addr_jibun) IS NOT NULL
           AND kepco_jibun_main(c.addr_jibun) <= 29
         ORDER BY kepco_jibun_main(c.addr_jibun) DESC, c.addr_jibun
         LIMIT 5
       ),
       upper5 AS (
         SELECT c.id, c.addr_jibun, kepco_jibun_main(c.addr_jibun) AS main
         FROM kepco_capa c
         WHERE c.bjd_code = '${bjd}'
           AND kepco_jibun_main(c.addr_jibun) IS NOT NULL
           AND kepco_jibun_main(c.addr_jibun) > 29
         ORDER BY kepco_jibun_main(c.addr_jibun) ASC, c.addr_jibun
         LIMIT 5
       )
       SELECT * FROM (
         SELECT * FROM lower5 UNION ALL SELECT * FROM upper5
       ) merged
       ORDER BY ABS(main - 29)`
    );
  }

  // ──────────────────────────────
  // B. 시나리오: 직리 (전국 동명이리)
  // ──────────────────────────────
  if (jikRiRows.length > 0) {
    const matched = jikRiRows.map((r) => `'${r.bjd_code}'`).join(",");
    const lotNo = 457;

    await explain(
      `[현재 RPC 시뮬] 폴백 — matched_bjd ${jikRiRows.length}개 + main <= ${lotNo}`,
      `WITH lower5 AS (
         SELECT c.id, c.addr_jibun, kepco_jibun_main(c.addr_jibun) AS main
         FROM kepco_capa c
         WHERE c.bjd_code = ANY(ARRAY[${matched}]::text[])
           AND kepco_jibun_main(c.addr_jibun) IS NOT NULL
           AND kepco_jibun_main(c.addr_jibun) <= ${lotNo}
         ORDER BY kepco_jibun_main(c.addr_jibun) DESC, c.addr_jibun
         LIMIT 5
       )
       SELECT * FROM lower5`
    );

    if (jikRiRows[0]) {
      await explain(
        `[새 구조 2단계] 직리 1개 선택 후 — bjd_code='${jikRiRows[0].bjd_code}'`,
        `WITH lower5 AS (
           SELECT c.id, c.addr_jibun, kepco_jibun_main(c.addr_jibun) AS main
           FROM kepco_capa c
           WHERE c.bjd_code = '${jikRiRows[0].bjd_code}'
             AND kepco_jibun_main(c.addr_jibun) IS NOT NULL
             AND kepco_jibun_main(c.addr_jibun) <= ${lotNo}
           ORDER BY kepco_jibun_main(c.addr_jibun) DESC, c.addr_jibun
           LIMIT 5
         )
         SELECT * FROM lower5`
      );
    }
  }

  // ──────────────────────────────
  // C. 현재 RPC 직접 호출 비교 — 다양한 케이스
  // ──────────────────────────────
  console.log("\n## C. 현재 search_kepco RPC 직접 호출 시간 측정");
  const rpcCases = [
    { label: "지토리 29 (정확)", kw: ["충청남도", "부여군", "장암면", "지토리"], lot: 29 },
    { label: "지토리 29 (약어 충남)", kw: ["충남", "부여군", "장암면", "지토리"], lot: 29 },
    { label: "지토리 9999 (없는 본번 → 폴백)", kw: ["충청남도", "부여군", "장암면", "지토리"], lot: 9999 },
    { label: "직리 457 (matched_bjd 다건)", kw: ["직리"], lot: 457 },
    { label: "직리 (lot 없음)", kw: ["직리"], lot: null },
    { label: "리 단독 (광범위 ri)", kw: ["리"], lot: null },
  ];
  for (const c of rpcCases) {
    try {
      const lotPart = c.lot === null ? "NULL" : c.lot;
      const kwArr = `ARRAY[${c.kw.map((k) => `'${k}'`).join(",")}]`;
      const t0 = Date.now();
      const res = await runSql(
        `SELECT search_kepco(${kwArr}, ${lotPart}, 20, 10) AS result;`
      );
      const elapsed = Date.now() - t0;
      const result = res[0]?.result;
      console.log(
        `[${elapsed}ms] ${c.label} → ri=${result?.ri?.length || 0}, ji=${result?.ji?.length || 0}, fallback=${result?.ji_fallback}, too_broad=${result?.too_broad}`
      );
    } catch (e) {
      console.log(`[ERROR] ${c.label}: ${e.message.slice(0, 200)}`);
    }
  }

  // ──────────────────────────────
  // D. 새 구조 시뮬레이션 — 같은 케이스 2단계
  // ──────────────────────────────
  console.log("\n## D. 새 구조 시뮬레이션 (1단계 + 2단계 합산)");
  const newCases = [
    { label: "지토리 29 정확", q: { sep1: "충청남도", sep3: "부여군", sep4: "장암면", sep5: "지토리" }, lot: 29 },
    { label: "지토리 29 약어", q: { sep1: "충남", sep3: "부여군", sep4: "장암면", sep5: "지토리" }, lot: 29 },
    { label: "지토리 9999 없음→폴백", q: { sep1: "충청남도", sep3: "부여군", sep4: "장암면", sep5: "지토리" }, lot: 9999 },
    { label: "직리만(후보 다건)", q: { sep5: "직리" }, lot: null },
  ];
  for (const c of newCases) {
    try {
      // 1단계: bjd_master 검색
      const conds = [];
      if (c.q.sep1) conds.push(`COALESCE(b.sep_1,'') ILIKE '%${c.q.sep1}%'`);
      if (c.q.sep3) conds.push(`COALESCE(b.sep_3,'') ILIKE '%${c.q.sep3}%'`);
      if (c.q.sep4) conds.push(`COALESCE(b.sep_4,'') ILIKE '%${c.q.sep4}%'`);
      if (c.q.sep5) conds.push(`COALESCE(b.sep_5,'') ILIKE '%${c.q.sep5}%'`);
      const t1Start = Date.now();
      const matches = await runSql(
        `SELECT b.bjd_code FROM bjd_master b WHERE ${conds.join(" AND ")} LIMIT 50`
      );
      const t1 = Date.now() - t1Start;
      let t2 = 0;
      let resultCount = 0;
      if (matches.length === 1 && c.lot !== null) {
        const bjd = matches[0].bjd_code;
        const t2Start = Date.now();
        // 정확 매칭 시도
        let rows = await runSql(
          `SELECT id FROM kepco_capa WHERE bjd_code = '${bjd}' AND kepco_jibun_main(addr_jibun) = ${c.lot} LIMIT 10`
        );
        if (rows.length === 0) {
          // 폴백
          rows = await runSql(`
            SELECT * FROM (
              (SELECT id, addr_jibun, kepco_jibun_main(addr_jibun) AS main FROM kepco_capa
                WHERE bjd_code='${bjd}' AND kepco_jibun_main(addr_jibun) IS NOT NULL
                AND kepco_jibun_main(addr_jibun) <= ${c.lot}
                ORDER BY kepco_jibun_main(addr_jibun) DESC LIMIT 5)
              UNION ALL
              (SELECT id, addr_jibun, kepco_jibun_main(addr_jibun) AS main FROM kepco_capa
                WHERE bjd_code='${bjd}' AND kepco_jibun_main(addr_jibun) IS NOT NULL
                AND kepco_jibun_main(addr_jibun) > ${c.lot}
                ORDER BY kepco_jibun_main(addr_jibun) ASC LIMIT 5)
            ) m ORDER BY ABS(main - ${c.lot})
          `);
        }
        t2 = Date.now() - t2Start;
        resultCount = rows.length;
      }
      console.log(
        `[1단계 ${t1}ms${t2 ? ` + 2단계 ${t2}ms` : ""}] ${c.label} → 후보 ${matches.length}개, 결과 ${resultCount}건`
      );
    } catch (e) {
      console.log(`[ERROR] ${c.label}: ${e.message.slice(0, 200)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
