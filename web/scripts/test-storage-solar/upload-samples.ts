/**
 * Storage 시범 — solar_permits 테이블 → BJD 별 JSON → Supabase Storage 업로드.
 *
 * 동작:
 *   1. DB 에서 발전소 보유 Top 10 BJD 추출
 *   2. 각 BJD 별 JSON 파일 생성 (메모리)
 *   3. Storage bucket 'solar-permits' 에 <bjd>.json 으로 업로드
 *
 * 실행 (web/ 안):
 *   npx tsx --env-file=.env.local scripts/test-storage-solar/upload-samples.ts
 *
 * 정리 (테스트 끝나면):
 *   npx tsx --env-file=.env.local scripts/test-storage-solar/cleanup.ts
 */
export {};

import { createClient } from "@supabase/supabase-js";

const BUCKET = "solar-permits";
const SAMPLE_LIMIT = 10;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

interface SolarRow {
  pnu: string;
  facility_name: string;
  capacity_kw: number | null;
  operating_status: string | null;
  permit_date: string | null;
  lat: number | null;
  lng: number | null;
}

async function pickTopBjds(): Promise<{ bjd_code: string; cnt: number }[]> {
  // PostgREST 는 GROUP BY 지원 안 — 클라 측 집계
  const { data, error } = await supabase
    .from("solar_permits")
    .select("bjd_code")
    .limit(100000);
  if (error) throw new Error(`bjd_code fetch 실패: ${error.message}`);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const code = (row as { bjd_code: string }).bjd_code;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, SAMPLE_LIMIT)
    .map(([bjd_code, cnt]) => ({ bjd_code, cnt }));
}

async function fetchRowsByBjd(bjd_code: string): Promise<SolarRow[]> {
  const { data, error } = await supabase
    .from("solar_permits")
    .select(
      "pnu, facility_name, capacity_kw, operating_status, permit_date, lat, lng",
    )
    .eq("bjd_code", bjd_code)
    .order("capacity_kw", { ascending: false });
  if (error) throw new Error(`${bjd_code} rows fetch 실패: ${error.message}`);
  return (data ?? []) as SolarRow[];
}

async function uploadJson(bjd_code: string, rows: SolarRow[]): Promise<number> {
  const json = JSON.stringify(rows);
  const buffer = new TextEncoder().encode(json);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${bjd_code}.json`, buffer, {
      contentType: "application/json",
      cacheControl: "3600",
      upsert: true,
    });
  if (error) throw new Error(`${bjd_code}.json 업로드 실패: ${error.message}`);
  return buffer.byteLength;
}

async function main() {
  console.log("=".repeat(60));
  console.log(" Storage 시범 — Top BJD 샘플 업로드");
  console.log("=".repeat(60));
  console.log(`  bucket : ${BUCKET}`);
  console.log(`  대상   : Top ${SAMPLE_LIMIT} BJD`);
  console.log("");

  const topBjds = await pickTopBjds();
  console.log(`Top BJD 추출 완료 (${topBjds.length}개):`);
  for (const { bjd_code, cnt } of topBjds) {
    console.log(`  ${bjd_code}  발전소 ${cnt}건`);
  }
  console.log("");

  let totalBytes = 0;
  for (const { bjd_code, cnt } of topBjds) {
    const rows = await fetchRowsByBjd(bjd_code);
    const bytes = await uploadJson(bjd_code, rows);
    totalBytes += bytes;
    console.log(
      `  ✓ ${bjd_code}.json  (${cnt}건, ${(bytes / 1024).toFixed(1)} KB)`,
    );
  }

  console.log("");
  console.log("=".repeat(60));
  console.log(` 업로드 완료 — ${topBjds.length}개 파일, 총 ${(totalBytes / 1024).toFixed(1)} KB`);
  console.log("=".repeat(60));
  console.log("");
  console.log("다음 단계:");
  console.log("  1. dev 서버 시작: npm run dev");
  console.log("  2. /api/solar-permits-v2/by-pnu?pnu=... 호출 검증");
  console.log("  3. 위 BJD 중 하나를 prefix 로 가진 PNU 매물 클릭");
  console.log("");
  console.log("정리:");
  console.log("  npx tsx --env-file=.env.local scripts/test-storage-solar/cleanup.ts");
}

main().catch((err) => {
  console.error("실패:", err);
  process.exit(1);
});
