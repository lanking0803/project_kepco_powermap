/**
 * Storage 시범 — 'solar-permits' bucket 의 모든 파일 삭제.
 *
 * 테스트 종료 후 실행:
 *   npx tsx --env-file=.env.local scripts/test-storage-solar/cleanup.ts
 *
 * bucket 자체는 남김 (파일만 비움). bucket 도 삭제하려면 Dashboard 에서.
 */
export {};

import { createClient } from "@supabase/supabase-js";

const BUCKET = "solar-permits";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function main() {
  console.log("=".repeat(60));
  console.log(` Storage 정리 — bucket '${BUCKET}'`);
  console.log("=".repeat(60));

  const { data: files, error: listErr } = await supabase.storage
    .from(BUCKET)
    .list("", { limit: 1000 });
  if (listErr) throw new Error(`목록 조회 실패: ${listErr.message}`);

  if (!files || files.length === 0) {
    console.log("  (이미 비어있음)");
    return;
  }

  console.log(`  발견: ${files.length}개 파일`);
  const names = files.map((f) => f.name);

  const { error: delErr } = await supabase.storage.from(BUCKET).remove(names);
  if (delErr) throw new Error(`삭제 실패: ${delErr.message}`);

  console.log(`  ✓ ${names.length}개 파일 삭제 완료`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("실패:", err);
  process.exit(1);
});
