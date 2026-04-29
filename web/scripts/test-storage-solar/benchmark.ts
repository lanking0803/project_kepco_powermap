/**
 * v1 (DB) vs v2 (Storage) 속도 비교 — bare workload 측정.
 *
 * API 라우트는 user 인증이 있어 직접 호출 어려우므로,
 * Supabase 호출 자체를 동일 PNU 로 N번 반복 측정.
 *
 * 실행 (web/ 안):
 *   npx tsx --env-file=.env.local scripts/test-storage-solar/benchmark.ts
 */
export {};

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const TEST_BJD = "2772031032"; // 43건 (가장 많은 BJD)
const TEST_PNU = `${TEST_BJD}100010000`;
const ITERATIONS = 10;

interface Stats {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p90: number;
}

function stats(times: number[]): Stats {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: times.reduce((s, t) => s + t, 0) / times.length,
    p50: sorted[Math.floor(times.length * 0.5)],
    p90: sorted[Math.floor(times.length * 0.9)],
  };
}

// V1 — DB 2쿼리 (현재 라우트와 동일)
async function v1Workload(): Promise<number> {
  const t0 = performance.now();
  const [samePnu, sameDong] = await Promise.all([
    supabase
      .from("solar_permits")
      .select(
        "facility_name, capacity_kw, operating_status, permit_date, lat, lng",
      )
      .eq("pnu", TEST_PNU)
      .order("capacity_kw", { ascending: false })
      .limit(50),
    supabase
      .from("solar_permits")
      .select("capacity_kw")
      .eq("bjd_code", TEST_BJD)
      .limit(1000),
  ]);
  if (samePnu.error || sameDong.error) {
    throw new Error(samePnu.error?.message || sameDong.error?.message);
  }
  const total = (sameDong.data ?? []).reduce(
    (s, r) => s + (Number(r.capacity_kw) || 0),
    0,
  );
  void total;
  return performance.now() - t0;
}

// V2 SDK — Storage 다운로드 (service_role 인증) + JS 가공
async function v2SdkWorkload(): Promise<number> {
  const t0 = performance.now();
  const { data: blob, error } = await supabase.storage
    .from("solar-permits")
    .download(`${TEST_BJD}.json`);
  if (error) throw new Error(error.message);
  const text = await blob.text();
  const rows = JSON.parse(text) as Array<{
    pnu: string;
    capacity_kw: number | null;
  }>;
  const samePnu = rows
    .filter((r) => r.pnu === TEST_PNU)
    .sort((a, b) => (b.capacity_kw ?? 0) - (a.capacity_kw ?? 0))
    .slice(0, 50);
  const total = rows.reduce((s, r) => s + (Number(r.capacity_kw) || 0), 0);
  void samePnu;
  void total;
  return performance.now() - t0;
}

// V2 RAW — Public bucket 의 raw URL 무인증 fetch (CDN 학습 가능)
const PROJECT_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const RAW_URL = (bjd: string) =>
  `${PROJECT_URL}/storage/v1/object/public/solar-permits/${bjd}.json`;

async function v2RawWorkload(): Promise<number> {
  const t0 = performance.now();
  const res = await fetch(RAW_URL(TEST_BJD));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const rows = JSON.parse(text) as Array<{
    pnu: string;
    capacity_kw: number | null;
  }>;
  const samePnu = rows
    .filter((r) => r.pnu === TEST_PNU)
    .sort((a, b) => (b.capacity_kw ?? 0) - (a.capacity_kw ?? 0))
    .slice(0, 50);
  const total = rows.reduce((s, r) => s + (Number(r.capacity_kw) || 0), 0);
  void samePnu;
  void total;
  return performance.now() - t0;
}

async function bench(
  name: string,
  fn: () => Promise<number>,
): Promise<Stats> {
  // Warmup 1회 (연결 풀 등)
  await fn();
  const times: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    times.push(await fn());
  }
  const s = stats(times);
  console.log(
    `  ${name.padEnd(20)} avg=${s.avg.toFixed(1)}ms  min=${s.min.toFixed(1)}  p50=${s.p50.toFixed(1)}  p90=${s.p90.toFixed(1)}  max=${s.max.toFixed(1)}`,
  );
  return s;
}

async function main() {
  console.log("=".repeat(70));
  console.log(" v1 (DB) vs v2 (Storage) 속도 비교");
  console.log("=".repeat(70));
  console.log(`  BJD : ${TEST_BJD} (43건)`);
  console.log(`  PNU : ${TEST_PNU}`);
  console.log(`  반복: ${ITERATIONS}회 (warmup 1회 별도)`);
  console.log("");

  console.log("  Pass 1 (cold)");
  const v1a = await bench("v1 (DB)", v1Workload);
  const v2sdkA = await bench("v2 SDK", v2SdkWorkload);
  const v2rawA = await bench("v2 raw fetch", v2RawWorkload);

  console.log("");
  console.log("  Pass 2 (CDN 학습 후)");
  const v1b = await bench("v1 (DB)", v1Workload);
  const v2sdkB = await bench("v2 SDK", v2SdkWorkload);
  const v2rawB = await bench("v2 raw fetch", v2RawWorkload);

  console.log("");
  console.log("=".repeat(70));
  console.log(" 결과 (v1 대비 비율)");
  console.log("=".repeat(70));
  const fmt = (s: Stats, base: Stats) =>
    `avg=${s.avg.toFixed(1)}ms (${(s.avg / base.avg).toFixed(2)}x)`;
  console.log("  Pass 1");
  console.log(`    v1 (DB)        avg=${v1a.avg.toFixed(1)}ms (1.00x baseline)`);
  console.log(`    v2 SDK         ${fmt(v2sdkA, v1a)}`);
  console.log(`    v2 raw fetch   ${fmt(v2rawA, v1a)}`);
  console.log("  Pass 2");
  console.log(`    v1 (DB)        avg=${v1b.avg.toFixed(1)}ms (1.00x baseline)`);
  console.log(`    v2 SDK         ${fmt(v2sdkB, v1b)}`);
  console.log(`    v2 raw fetch   ${fmt(v2rawB, v1b)}`);
  console.log("");
  console.log("주의:");
  console.log("  • bare workload — Vercel/Next.js fetch 캐시 적용 X");
  console.log("  • Public bucket 이라 raw fetch 가 Smart CDN 학습 가능");
  console.log("  • 실제 운영에선 Next.js fetch revalidate 캐시가 추가됨");
}

main().catch((err) => {
  console.error("실패:", err);
  process.exit(1);
});
