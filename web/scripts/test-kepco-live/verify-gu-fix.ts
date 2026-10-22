/**
 * gu 빈값 → -기타지역 픽스 검증 e2e.
 *
 * 실행:
 *   cd web && npx tsx --env-file=.env.local scripts/test-kepco-live/verify-gu-fix.ts
 *
 * 검증 케이스 — 의뢰자 KEPCO 사이트 캡처로 정답 알려진 4건:
 *   A1. 김해 외동 1107-5  (도-시-동, 픽스 직격) → ✅ 매칭 기대
 *   A2. 양산 덕계동 805-3 (도-시-동, 픽스 직격) → ✅ 매칭 기대
 *   A3. 밀양 가곡동 10-16 (도-시-동, 픽스 직격) → ✅ 매칭 기대
 *   B1. 부산 우동 1025-94 (광역시 자치구, 회귀방지) → ✅ 매칭 기대
 *   C1. 정선 유평리 산331 (KEPCO 미보유 확정) → not_found 기대
 *
 * 픽스 효과 판정:
 *   A1~A3 중 하나라도 kepco_live 결과 나오면 픽스 성공
 *   픽스 전엔 모두 not_found (gu="" 보내서 KEPCO 0건 응답)
 */

import { lookupCapacity } from "@/lib/kepco-live/lookup-capacity";
import { buildKepcoCandidates } from "@/lib/kepco-live/build-candidates";
import { parseKoreanAddress } from "@/lib/kepco-live/parse-address";

interface Case {
  label: string;
  bjdCode: string;
  jibun: string;
  expect: "live" | "not_found";
  // 코드 레벨 검증용 (parsed sep)
  addrForSepCheck: string;
}

const CASES: Case[] = [
  {
    label: "A1. 김해 외동 1107-5 (도-시-동, gu 빈값 픽스 직격)",
    bjdCode: "4825010900",
    jibun: "1107-5",
    expect: "live",
    addrForSepCheck: "경상남도 김해시 외동 1107-5",
  },
  {
    label: "A2. 양산 덕계동 805-3 (도-시-동)",
    bjdCode: "4833012000",
    jibun: "805-3",
    expect: "live",
    addrForSepCheck: "경상남도 양산시 덕계동 805-3",
  },
  {
    label: "A3. 밀양 가곡동 10-16 (도-시-동)",
    bjdCode: "4827010800",
    jibun: "10-16",
    expect: "live",
    addrForSepCheck: "경상남도 밀양시 가곡동 10-16",
  },
  {
    label: "B1. 부산 해운대구 우동 1025-94 (광역시 자치구, 회귀방지)",
    bjdCode: "2635010500",
    jibun: "1025-94",
    expect: "live",
    addrForSepCheck: "부산광역시 해운대구 우동 1025-94",
  },
  {
    label: "C1. 정선 남면 유평리 산331 (KEPCO 미보유 확정)",
    bjdCode: "5177032023",
    jibun: "산331",
    expect: "not_found",
    addrForSepCheck: "강원특별자치도 정선군 남면 유평리 산331",
  },
];

function fmt1stCandidate(addr: string): string {
  const parsed = parseKoreanAddress(addr);
  const cands = buildKepcoCandidates(parsed);
  const c = cands[0];
  return `do='${c.do}' si='${c.si}' gu='${c.gu}' lidong='${c.lidong}' li='${c.li}'`;
}

async function run() {
  let pass = 0;
  let fail = 0;
  const details: string[] = [];

  for (const c of CASES) {
    console.log(`\n━━━ ${c.label} ━━━`);
    console.log(`  PNU/bjd: ${c.bjdCode} + jibun='${c.jibun}'`);
    console.log(`  코드 1차 후보: ${fmt1stCandidate(c.addrForSepCheck)}`);

    try {
      const start = Date.now();
      const res = await lookupCapacity({
        bjd_code: c.bjdCode,
        jibun: c.jibun,
        refresh: true, // 항상 KEPCO live 호출 (DB cache 우회)
      });
      const elapsed = Date.now() - start;

      const ok =
        (c.expect === "live" && res.source === "kepco_live") ||
        (c.expect === "not_found" && res.source === "not_found");

      console.log(`  source: ${res.source} (${elapsed}ms)  rows=${res.rows.length}`);
      if (res.candidate_used) {
        console.log(
          `  matched cand: si='${res.candidate_used.si}' gu='${res.candidate_used.gu}' (${res.candidate_used.reason})`,
        );
      }
      if (res.rows.length > 0) {
        const r0 = res.rows[0];
        console.log(`  sample: SUBST=${r0.subst_nm ?? "?"}  DL=${r0.dl_nm ?? "?"}`);
      }

      if (ok) {
        pass++;
        console.log(`  ✅ PASS (expect=${c.expect})`);
        details.push(`✅ ${c.label}`);
      } else {
        fail++;
        console.log(`  ❌ FAIL (expect=${c.expect}, got=${res.source})`);
        details.push(`❌ ${c.label} (expect=${c.expect}, got=${res.source})`);
      }
    } catch (e) {
      fail++;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  💥 EXCEPTION: ${msg}`);
      details.push(`💥 ${c.label} — ${msg}`);
    }
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`최종: ${pass} pass / ${fail} fail / 총 ${CASES.length}`);
  console.log(`${"═".repeat(60)}`);
  details.forEach((d) => console.log("  " + d));

  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(2);
});
