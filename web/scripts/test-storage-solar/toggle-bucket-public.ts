/**
 * 'solar-permits' bucket 을 public ↔ private 토글.
 *
 * 실행:
 *   npx tsx --env-file=.env.local scripts/test-storage-solar/toggle-bucket-public.ts public
 *   npx tsx --env-file=.env.local scripts/test-storage-solar/toggle-bucket-public.ts private
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
  const arg = process.argv[2];
  if (arg !== "public" && arg !== "private") {
    console.error("사용법: ... toggle-bucket-public.ts [public|private]");
    process.exit(1);
  }
  const wantPublic = arg === "public";

  const { data, error } = await supabase.storage.updateBucket(BUCKET, {
    public: wantPublic,
  });
  if (error) throw new Error(`updateBucket 실패: ${error.message}`);

  console.log(`✓ bucket '${BUCKET}' → ${wantPublic ? "Public" : "Private"}`);
  console.log("  응답:", JSON.stringify(data));

  // 검증 — 메타 다시 읽기
  const { data: info, error: infoErr } = await supabase.storage.getBucket(
    BUCKET,
  );
  if (infoErr) throw new Error(`getBucket 실패: ${infoErr.message}`);
  console.log(`  실제 public: ${info.public}`);
}

main().catch((err) => {
  console.error("실패:", err);
  process.exit(1);
});
