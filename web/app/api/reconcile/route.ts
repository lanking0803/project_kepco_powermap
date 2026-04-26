/**
 * Worker — DB 와 GitHub Actions 의 상태 불일치를 감지하고 보정한다.
 *
 * 설계 원칙 (2중 제어 모델):
 *   - 평상시엔 개입하지 않는다. API / 크롤러가 알아서 한다.
 *   - 문제(dispatch 실패, cancel 무시, 크롤러 돌연사)가 있을 때만 강제 보정.
 *   - DB 만 읽고 판단한다. GitHub API 는 액션(cancel, dispatch) 에만 호출.
 *
 * 호출 경로:
 *   Supabase pg_cron (매 1분) → POST /api/reconcile (Authorization: Bearer <CRON_SECRET>)
 *
 * 판단 규칙 (12줄 표):
 *   intent | status      | heartbeat | 액션
 *   -------+-------------+-----------+-----------------------------
 *   run    | pending     | 10분+     | redispatch
 *   run    | running     | 정상      | skip
 *   run    | running     | 3분+      | mark_failed + resume 시도
 *   run    | completed + checkpoint  | resume (이어받기)
 *   run    | completed + recurring   | resume (다음 사이클)
 *   run    | completed + single      | skip
 *   run    | failed + checkpoint     | resume (재시도, max 5회)
 *   run    | cancelled               | skip
 *   cancel | pending                 | mark_cancelled
 *   cancel | running     | 정상      | gh_cancel (status 는 크롤러가 씀)
 *   cancel | running     | 3분+      | mark_cancelled (좀비는 Worker 가 직접)
 *   cancel | 종료 상태               | skip
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const meta: EndpointMeta = {
  source:
    "DB (crawl_jobs) 판단 + 필요 시 GitHub Actions API (cancel/dispatch)",
  cache: "no-store",
  auth: "system",
  inputs: [],
  outputSchema:
    "{ ok: true, reconciled: number, actions: Array<{ jobId, action, reason }> } — 12줄 판단표 기반",
  externalDeps: ["supabase", "github-actions"],
  notes:
    "Authorization: Bearer ${CRON_SECRET} 헤더 필요. Supabase pg_cron 매 1분 호출. 라이브 테스트 시 헤더 직접 입력 필요. 좀비 작업 정리 + 실패 작업 자동 재시도 (max 5회).",
};

const GITHUB_PAT = process.env.GH_PAT || process.env.GITHUB_PAT || "";
const GITHUB_REPO = process.env.GITHUB_REPO || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

const HEARTBEAT_ZOMBIE_MS = 3 * 60 * 1000;
const PENDING_REDISPATCH_MS = 10 * 60 * 1000;
const MAX_WORKER_RETRIES = 5;
const THREADS = [1, 2, 3, 4, 5] as const;

type CrawlJob = {
  id: number;
  thread: number;
  sido: string;
  si: string | null;
  gu: string | null;
  dong: string | null;
  li: string | null;
  mode: "single" | "recurring";
  options: Record<string, unknown>;
  max_cycles: number | null;
  cycle_count: number;
  intent: "run" | "cancel";
  requested_by: string | null;
  status: string;
  github_run_id: number | null;
  last_heartbeat: string | null;
  checkpoint: Record<string, unknown> | null;
  created_at: string;
};

type ActionResult = {
  thread: number;
  job_id: number | null;
  action: string;
  success?: boolean;
  reason?: string;
  new_job_id?: number;
};

// ─────────────────────────────────────────────
// Entry — pg_cron 이 Bearer 토큰으로 호출
// ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!CRON_SECRET) {
    console.error("[reconcile] CRON_SECRET 미설정 — Worker 비활성");
    return NextResponse.json({ ok: false, error: "CRON_SECRET 미설정" }, { status: 500 });
  }

  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${CRON_SECRET}`) {
    console.warn("[reconcile] 인증 실패");
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const results: ActionResult[] = [];

  for (const thread of THREADS) {
    try {
      const job = await fetchLatestRelevantJob(thread);
      const result = await reconcileThread(thread, job);
      results.push(result);
    } catch (err) {
      console.error(`[reconcile] thread=${thread} 예외:`, err);
      results.push({
        thread,
        job_id: null,
        action: "error",
        success: false,
        reason: String(err),
      });
    }
  }

  const elapsed = Date.now() - startedAt;
  const acted = results.filter((r) => r.action !== "skip" && r.action !== "error").length;
  console.log(
    `[reconcile] tick 완료 elapsed=${elapsed}ms acted=${acted}/${results.length} ` +
      JSON.stringify(results),
  );

  return NextResponse.json({ ok: true, ran_at: new Date().toISOString(), elapsed_ms: elapsed, results });
}

// ─────────────────────────────────────────────
// thread 별 reconcile 로직
// ─────────────────────────────────────────────
async function reconcileThread(thread: number, job: CrawlJob | null): Promise<ActionResult> {
  if (!job) return { thread, job_id: null, action: "skip", reason: "no_active_job" };

  const heartbeatAge = job.last_heartbeat
    ? Date.now() - new Date(job.last_heartbeat).getTime()
    : Infinity;
  const createdAge = Date.now() - new Date(job.created_at).getTime();
  const isZombie = heartbeatAge > HEARTBEAT_ZOMBIE_MS;

  // ── intent='cancel' 계열 ──
  if (job.intent === "cancel") {
    if (["completed", "cancelled", "failed"].includes(job.status)) {
      return { thread, job_id: job.id, action: "skip", reason: "terminal" };
    }

    if (job.status === "pending") {
      await markCancelled(job.id, "사용자 정지 — pending 상태에서 확정 취소");
      return { thread, job_id: job.id, action: "mark_cancelled", success: true };
    }

    // status === 'running'
    if (isZombie) {
      await markCancelled(
        job.id,
        `사용자 정지 + heartbeat ${Math.round(heartbeatAge / 60000)}분 끊김 (좀비)`,
      );
      return { thread, job_id: job.id, action: "mark_cancelled", success: true, reason: "zombie" };
    }

    if (job.github_run_id) {
      const ok = await ghCancel(job.github_run_id);
      return { thread, job_id: job.id, action: "gh_cancel", success: ok };
    }

    // github_run_id 가 아직 없음 — 크롤러 시작 전 → pending 처럼 그냥 cancelled
    await markCancelled(job.id, "사용자 정지 — github_run_id 미확보 상태에서 확정 취소");
    return { thread, job_id: job.id, action: "mark_cancelled", success: true, reason: "no_run_id" };
  }

  // ── intent='run' 계열 ──
  if (job.status === "pending") {
    if (createdAge > PENDING_REDISPATCH_MS) {
      const ok = await ghDispatch(job.id, thread);
      return { thread, job_id: job.id, action: "redispatch", success: ok };
    }
    return { thread, job_id: job.id, action: "skip", reason: "pending_fresh" };
  }

  if (job.status === "running") {
    if (isZombie) {
      await markFailed(job.id, `좀비 감지: heartbeat ${Math.round(heartbeatAge / 60000)}분 끊김`);
      return await tryResume(job, "zombie_retry", thread);
    }
    return { thread, job_id: job.id, action: "skip", reason: "healthy" };
  }

  if (job.status === "completed") {
    if (job.checkpoint) {
      return await tryResume(job, "timeout_resume", thread);
    }
    if (job.mode === "recurring") {
      return await tryResumeRecurring(job, thread);
    }
    return { thread, job_id: job.id, action: "skip", reason: "completed_single" };
  }

  if (job.status === "failed" && job.checkpoint) {
    return await tryResume(job, "failure_retry", thread);
  }

  return { thread, job_id: job.id, action: "skip", reason: "terminal_run" };
}

// ─────────────────────────────────────────────
// DB 조회 — thread 의 "현재" Job (의도가 살아있는 최근 Job)
// ─────────────────────────────────────────────
async function fetchLatestRelevantJob(thread: number): Promise<CrawlJob | null> {
  const supabase = createAdminClient();

  // 1) 활성 Job (pending/running) 가장 최근
  const { data: activeRows } = await supabase
    .from("crawl_jobs")
    .select("*")
    .eq("thread", thread)
    .in("status", ["pending", "running"])
    .order("id", { ascending: false })
    .limit(1);

  if (activeRows && activeRows.length > 0) return activeRows[0] as CrawlJob;

  // 2) 활성 없으면 최근 intent='run' Job 중 종료 상태 (resume 판단용)
  //    cancelled 는 사용자가 명시적으로 끊은 것이므로 제외
  const { data: recentRows } = await supabase
    .from("crawl_jobs")
    .select("*")
    .eq("thread", thread)
    .eq("intent", "run")
    .in("status", ["completed", "failed"])
    .order("id", { ascending: false })
    .limit(1);

  return recentRows && recentRows.length > 0 ? (recentRows[0] as CrawlJob) : null;
}

// ─────────────────────────────────────────────
// 액션 — DB 갱신
// ─────────────────────────────────────────────
async function markCancelled(jobId: number, reason: string) {
  const supabase = createAdminClient();
  await supabase
    .from("crawl_jobs")
    .update({
      status: "cancelled",
      error_message: reason,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  console.log(`[reconcile] mark_cancelled id=${jobId} reason="${reason}"`);
}

async function markFailed(jobId: number, reason: string) {
  const supabase = createAdminClient();
  await supabase
    .from("crawl_jobs")
    .update({
      status: "failed",
      error_message: reason,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  console.log(`[reconcile] mark_failed id=${jobId} reason="${reason}"`);
}

// ─────────────────────────────────────────────
// 액션 — 재개 (새 Job 생성 + dispatch)
// ─────────────────────────────────────────────
async function tryResume(parent: CrawlJob, origin: string, thread: number): Promise<ActionResult> {
  const options = (parent.options ?? {}) as Record<string, unknown>;
  const retries = Number(options._worker_retries ?? 0);
  if (retries >= MAX_WORKER_RETRIES) {
    console.warn(
      `[reconcile] thread=${thread} resume 포기 parent=${parent.id} retries=${retries}>=${MAX_WORKER_RETRIES}`,
    );
    return {
      thread,
      job_id: parent.id,
      action: "skip",
      reason: `max_worker_retries(${retries})`,
    };
  }

  const supabase = createAdminClient();
  const newJob = {
    sido: parent.sido,
    si: parent.si,
    gu: parent.gu,
    dong: parent.dong,
    li: parent.li,
    mode: parent.mode,
    options: { ...options, _worker_retries: retries + 1, _worker_origin: origin },
    max_cycles: parent.max_cycles,
    cycle_count: parent.cycle_count,
    checkpoint: parent.checkpoint,
    requested_by: parent.requested_by,
    thread,
  };
  const { data: inserted, error } = await supabase
    .from("crawl_jobs")
    .insert(newJob)
    .select()
    .single();
  if (error || !inserted) {
    console.error(`[reconcile] resume INSERT 실패 parent=${parent.id}:`, error);
    return { thread, job_id: parent.id, action: "resume", success: false, reason: error?.message };
  }
  const ok = await ghDispatch(inserted.id, thread);
  console.log(
    `[reconcile] resume origin=${origin} parent=${parent.id} new=${inserted.id} dispatch=${ok ? "ok" : "FAIL"}`,
  );
  return {
    thread,
    job_id: parent.id,
    action: "resume",
    success: ok,
    new_job_id: inserted.id,
    reason: origin,
  };
}

async function tryResumeRecurring(parent: CrawlJob, thread: number): Promise<ActionResult> {
  // recurring 다음 사이클 — cycle_count 증가, checkpoint 초기화
  const nextCycle = parent.cycle_count + 1;
  if (parent.max_cycles && nextCycle >= parent.max_cycles) {
    return { thread, job_id: parent.id, action: "skip", reason: "max_cycles_reached" };
  }

  const options = (parent.options ?? {}) as Record<string, unknown>;
  const retries = Number(options._worker_retries ?? 0);
  if (retries >= MAX_WORKER_RETRIES) {
    return { thread, job_id: parent.id, action: "skip", reason: `max_worker_retries(${retries})` };
  }

  const supabase = createAdminClient();
  const newJob = {
    sido: parent.sido,
    si: parent.si,
    gu: parent.gu,
    dong: parent.dong,
    li: parent.li,
    mode: parent.mode,
    options: { ...options, _worker_retries: retries + 1, _worker_origin: "next_cycle" },
    max_cycles: parent.max_cycles,
    cycle_count: nextCycle,
    checkpoint: null,
    requested_by: parent.requested_by,
    thread,
  };
  const { data: inserted, error } = await supabase
    .from("crawl_jobs")
    .insert(newJob)
    .select()
    .single();
  if (error || !inserted) {
    console.error(`[reconcile] next_cycle INSERT 실패 parent=${parent.id}:`, error);
    return { thread, job_id: parent.id, action: "resume", success: false, reason: error?.message };
  }
  const ok = await ghDispatch(inserted.id, thread);
  console.log(
    `[reconcile] next_cycle parent=${parent.id} new=${inserted.id} cycle=${nextCycle} dispatch=${ok ? "ok" : "FAIL"}`,
  );
  return {
    thread,
    job_id: parent.id,
    action: "resume",
    success: ok,
    new_job_id: inserted.id,
    reason: "next_cycle",
  };
}

// ─────────────────────────────────────────────
// GitHub Actions 액션
// ─────────────────────────────────────────────
async function ghDispatch(jobId: number, thread: number): Promise<boolean> {
  if (!GITHUB_PAT || !GITHUB_REPO) {
    console.error("[reconcile] GH_PAT/GITHUB_REPO 미설정 — dispatch 불가");
    return false;
  }
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/crawl.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `token ${GITHUB_PAT}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ref: "main",
          inputs: { job_id: String(jobId), thread: String(thread) },
        }),
      },
    );
    if (!resp.ok) {
      console.error(`[reconcile] dispatch 실패 job=${jobId} status=${resp.status}: ${await resp.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[reconcile] dispatch 네트워크 오류 job=${jobId}:`, err);
    return false;
  }
}

async function ghCancel(runId: number): Promise<boolean> {
  if (!GITHUB_PAT || !GITHUB_REPO) {
    console.error("[reconcile] GH_PAT/GITHUB_REPO 미설정 — cancel 불가");
    return false;
  }
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/runs/${runId}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `token ${GITHUB_PAT}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );
    // 202 Accepted = 취소 요청 접수. 404 = 이미 종료됨 (그것도 OK).
    if (resp.status === 202 || resp.status === 404) return true;
    console.error(`[reconcile] cancel 실패 run=${runId} status=${resp.status}: ${await resp.text()}`);
    return false;
  } catch (err) {
    console.error(`[reconcile] cancel 네트워크 오류 run=${runId}:`, err);
    return false;
  }
}
