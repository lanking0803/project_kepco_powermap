/**
 * 관리자 전용 — 크롤링 작업 관리 (2중 제어 모델)
 *
 * GET    /api/admin/crawl          → 작업 목록 (최신 50건)
 * POST   /api/admin/crawl          → 새 Job 생성 (intent='run') + GitHub Actions 트리거
 * PATCH  /api/admin/crawl          → 정지 요청 (intent='cancel' + GH run cancel)
 * DELETE /api/admin/crawl?id=      → 종료된 Job 기록 삭제
 *
 * 설계 원칙:
 *   - API 는 "의도(intent)" 만 기록한다.
 *   - "관측(status)" 은 크롤러와 Worker(/api/reconcile) 가 갱신한다.
 *   - 좀비 정리는 Worker 주기에 맡긴다 (여기서 하면 2중 구조가 무의미).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const metaGET: EndpointMeta = {
  source: "DB (crawl_jobs 최신 50건)",
  cache: "no-store",
  auth: "admin",
  inputs: [],
  outputSchema: "{ ok, jobs: CrawlJob[] }",
  externalDeps: ["supabase"],
  notes: "관리자 화면의 작업 목록. 정렬: created_at DESC, limit 50.",
};

export const metaPOST: EndpointMeta = {
  source: "DB insert (crawl_jobs) + GitHub Actions workflow_dispatch",
  cache: "no-store",
  auth: "admin",
  inputs: [
    { name: "thread", type: "number", required: true, sample: "1", description: "1~5 (스레드 슬롯)" },
    { name: "sido", type: "string", required: true, sample: "경기도" },
    { name: "si", type: "string", required: false, sample: "양평군" },
    { name: "gu", type: "string", required: false, sample: "" },
    { name: "dong", type: "string", required: false, sample: "청운면" },
    { name: "li", type: "string", required: false, sample: "갈운리" },
    { name: "mode", type: "string", required: false, sample: "single", description: "single | recurring" },
  ],
  outputSchema: "{ ok, job: CrawlJob }",
  externalDeps: ["supabase", "github-actions"],
  notes:
    "API 는 의도(intent='run') 만 기록. status 는 크롤러가 갱신 (2중 제어). 동시 같은 thread 점유 시 409 반환.",
};

export const metaPATCH: EndpointMeta = {
  source: "DB update (intent='cancel') + GitHub Actions runs cancel",
  cache: "no-store",
  auth: "admin",
  inputs: [
    { name: "id", type: "number", required: true, sample: "1234", description: "Job ID (body)" },
  ],
  outputSchema: "{ ok }",
  externalDeps: ["supabase", "github-actions"],
  notes:
    "정지 요청 — intent 만 변경, 실제 status 는 Worker(/api/reconcile) 가 처리. 좀비 정리도 Worker 위임.",
};

export const metaDELETE: EndpointMeta = {
  source: "DB delete (crawl_jobs WHERE id=$1, 종료된 Job 만)",
  cache: "no-store",
  auth: "admin",
  inputs: [
    { name: "id", type: "number", required: true, sample: "1234", description: "Job ID (querystring)" },
  ],
  outputSchema: "{ ok }",
  externalDeps: ["supabase"],
  dangerous: true,
  dangerNote:
    "Job 기록 영구 삭제. running/pending 인 Job 은 422 (먼저 cancel 필요).",
  notes: "히스토리에서 한 줄 지우는 용도. 실행 중 Job 은 보호.",
};

const GITHUB_PAT = process.env.GH_PAT || process.env.GITHUB_PAT || "";
const GITHUB_REPO = process.env.GITHUB_REPO || ""; // "owner/repo"

// ─────────────────────────────────────────────
// GET — 작업 목록
// ─────────────────────────────────────────────
export async function GET() {
  const me = await requireAdmin();
  if (!me) {
    return NextResponse.json(
      { ok: false, error: "관리자만 접근 가능합니다." },
      { status: 403 }
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("crawl_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, jobs: data });
}

// ─────────────────────────────────────────────
// POST — 새 Job 생성 + GH Actions 트리거
// ─────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const me = await requireAdmin();
  if (!me) {
    return NextResponse.json(
      { ok: false, error: "관리자만 접근 가능합니다." },
      { status: 403 }
    );
  }

  let body: {
    sido: string;
    si?: string;
    gu?: string;
    dong?: string;
    li?: string;
    options?: {
      fetch_step_data?: boolean;
      delay?: number;
      flush_size?: number;
      progress_interval?: number;
    };
    checkpoint?: Record<string, unknown>;
    thread?: number;
    mode?: "single" | "recurring";
    max_cycles?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "잘못된 요청" },
      { status: 400 }
    );
  }

  if (!body.sido?.trim()) {
    return NextResponse.json(
      { ok: false, error: "시/도를 선택해주세요." },
      { status: 400 }
    );
  }

  const thread = body.thread || 1;
  if (![1, 2, 3, 4, 5].includes(thread)) {
    return NextResponse.json(
      { ok: false, error: "스레드 번호는 1~5 중 하나여야 합니다." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // 같은 thread 에 이미 활성 Job (pending/running) 이 있으면 차단.
  // Worker 가 좀비를 정리하므로 여기선 "살아있는 intent='run'" 만 체크.
  const { data: existing } = await supabase
    .from("crawl_jobs")
    .select("id, status, sido, intent")
    .in("status", ["pending", "running"])
    .eq("thread", thread)
    .eq("intent", "run")
    .limit(1);

  if (existing && existing.length > 0) {
    const ej = existing[0];
    const statusLabel = ej.status === "running" ? "실행 중" : "대기 중";
    return NextResponse.json(
      {
        ok: false,
        error: `스레드 ${thread}에 이미 ${statusLabel}인 작업이 있습니다. (Job #${ej.id} — ${ej.sido})`,
      },
      { status: 409 }
    );
  }

  // 새 Job INSERT (intent='run' 기본값, status='pending' 기본값)
  const { data: job, error: insertErr } = await supabase
    .from("crawl_jobs")
    .insert({
      sido: body.sido.trim(),
      si: body.si?.trim() || null,
      gu: body.gu?.trim() || null,
      dong: body.dong?.trim() || null,
      li: body.li?.trim() || null,
      options: body.options || {},
      checkpoint: body.checkpoint || null,
      requested_by: me.id,
      thread,
      mode: body.mode || "single",
      cycle_count: 0,
      max_cycles: body.max_cycles || null,
    })
    .select()
    .single();

  if (insertErr || !job) {
    return NextResponse.json(
      { ok: false, error: insertErr?.message || "작업 생성 실패" },
      { status: 500 }
    );
  }

  // GitHub Actions workflow_dispatch 트리거.
  // 실패해도 Job 은 남아있음 — Worker 가 주기 체크에서 재dispatch 시도.
  let warning: string | undefined;
  if (GITHUB_PAT && GITHUB_REPO) {
    try {
      const ghResp = await fetch(
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
            inputs: {
              job_id: String(job.id),
              thread: String(thread),
            },
          }),
        }
      );
      if (!ghResp.ok) {
        const errText = await ghResp.text();
        console.error(
          `[GitHub Actions] dispatch 실패 (${ghResp.status}):`,
          errText
        );
        warning = "GitHub Actions 트리거 실패 — Worker 가 곧 재시도합니다.";
      }
    } catch (err) {
      console.error("[GitHub Actions] dispatch 네트워크 오류:", err);
      warning = "GitHub Actions 트리거 실패 — Worker 가 곧 재시도합니다.";
    }
  } else {
    warning = "GITHUB_PAT/GITHUB_REPO 미설정 — dispatch 생략됨.";
  }

  return NextResponse.json({ ok: true, job, ...(warning ? { warning } : {}) });
}

// ─────────────────────────────────────────────
// PATCH — 정지 요청 (intent='cancel' 기록 + GH run cancel)
// ─────────────────────────────────────────────
export async function PATCH(request: NextRequest) {
  const me = await requireAdmin();
  if (!me) {
    return NextResponse.json(
      { ok: false, error: "관리자만 접근 가능합니다." },
      { status: 403 }
    );
  }

  let body: { id: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "잘못된 요청" },
      { status: 400 }
    );
  }

  if (!body.id) {
    return NextResponse.json(
      { ok: false, error: "작업 ID가 필요합니다." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  const { data: job, error: readErr } = await supabase
    .from("crawl_jobs")
    .select("id, status, intent, github_run_id, last_heartbeat")
    .eq("id", body.id)
    .single();

  if (readErr || !job) {
    return NextResponse.json(
      { ok: false, error: readErr?.message ?? "작업을 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  // 이미 종료된 Job 은 스킵
  if (["completed", "cancelled", "failed"].includes(job.status)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      message: `Job 은 이미 종료 상태(${job.status})입니다.`,
    });
  }

  // ─── pending 즉시 처분 ───
  // pending 은 아직 크롤러가 시작 못 함 → intent 만 찍어도 감지할 주체 없음.
  // 바로 status='cancelled' 로 마감해서 UI 깨끗하게.
  if (job.status === "pending") {
    const { error } = await supabase
      .from("crawl_jobs")
      .update({
        intent: "cancel",
        status: "cancelled",
        error_message: "사용자 정지 — pending 상태에서 확정 취소",
        completed_at: new Date().toISOString(),
      })
      .eq("id", body.id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, message: "pending Job 취소 완료" });
  }

  // ─── 좀비 즉시 처분 ───
  // running 인데 heartbeat 3분+ 끊겼으면 크롤러 프로세스가 죽은 것.
  // intent='cancel' 찍어봐야 감지할 주체가 없으므로 즉시 status='cancelled' 로 마감.
  const HEARTBEAT_ZOMBIE_MS = 3 * 60 * 1000;
  const heartbeatAge = job.last_heartbeat
    ? Date.now() - new Date(job.last_heartbeat).getTime()
    : Infinity;

  if (job.status === "running" && heartbeatAge > HEARTBEAT_ZOMBIE_MS) {
    const ageMin = Math.round(heartbeatAge / 60000);
    const { error: killErr } = await supabase
      .from("crawl_jobs")
      .update({
        intent: "cancel",
        status: "cancelled",
        error_message: `좀비 정지: heartbeat ${ageMin}분 끊김 (PATCH 에서 즉시 처분)`,
        completed_at: new Date().toISOString(),
      })
      .eq("id", body.id);

    if (killErr) {
      return NextResponse.json(
        { ok: false, error: killErr.message },
        { status: 500 }
      );
    }

    // 만일의 살아있음 대비 GH cancel 도 쏨 (fire-and-forget)
    if (job.github_run_id && GITHUB_PAT && GITHUB_REPO) {
      fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/actions/runs/${job.github_run_id}/cancel`,
        {
          method: "POST",
          headers: {
            Authorization: `token ${GITHUB_PAT}`,
            Accept: "application/vnd.github.v3+json",
          },
        }
      ).catch(() => {
        /* zombie 처분이 이미 끝남 — GH 응답 무관 */
      });
    }

    return NextResponse.json({
      ok: true,
      zombie: true,
      message: `좀비 감지 (heartbeat ${ageMin}분 끊김) — 즉시 cancelled 처리`,
    });
  }

  // ─── 정상 정지 요청 ───
  // 1) DB 에 의도 기록 (마스터)
  const { error: updErr } = await supabase
    .from("crawl_jobs")
    .update({ intent: "cancel" })
    .eq("id", body.id);

  if (updErr) {
    return NextResponse.json(
      { ok: false, error: updErr.message },
      { status: 500 }
    );
  }

  // 2) GitHub run cancel — await 해서 응답 확인.
  //    GH 가 202(Accepted) 또는 409(Conflict - 이미 cancel 중) 주면
  //    run 을 kill 할 것이 확정되므로 크롤러가 자기 status 를 못 씀.
  //    우리가 대신 status='cancelled' 를 마킹해서 UI 가 빠르게 전환되게.
  //    (타임아웃 5초 — 초과 시 intent 만 남기고 크롤러 self-check 에 맡김)
  let ghConfirmed = false;
  if (job.github_run_id && GITHUB_PAT && GITHUB_REPO) {
    try {
      const resp = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/actions/runs/${job.github_run_id}/cancel`,
        {
          method: "POST",
          headers: {
            Authorization: `token ${GITHUB_PAT}`,
            Accept: "application/vnd.github.v3+json",
          },
          signal: AbortSignal.timeout(5000),
        }
      );
      if (resp.status === 202 || resp.status === 409 || resp.status === 404) {
        // 404 = run 이 이미 완전히 없어진 경우 — 어차피 끝
        ghConfirmed = true;
      } else {
        console.error(`[GitHub Actions] run cancel 비정상 응답 (${resp.status}):`, await resp.text());
      }
    } catch (err) {
      console.error("[GitHub Actions] run cancel 오류:", err);
    }
  }

  // 3) GH cancel 이 수락됐으면 status 도 우리가 확정
  if (ghConfirmed) {
    await supabase
      .from("crawl_jobs")
      .update({
        status: "cancelled",
        error_message: "사용자 정지 — GH run cancel 수락 확정",
        completed_at: new Date().toISOString(),
      })
      .eq("id", body.id);
  }

  return NextResponse.json({ ok: true, gh_confirmed: ghConfirmed });
}

// ─────────────────────────────────────────────
// DELETE — 종료된 Job 기록 삭제
// ─────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  const me = await requireAdmin();
  if (!me) {
    return NextResponse.json(
      { ok: false, error: "관리자만 접근 가능합니다." },
      { status: 403 }
    );
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "작업 ID가 필요합니다." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // 활성 Job 은 삭제 불가 — 먼저 PATCH 로 cancel 해야 함
  const { data: job } = await supabase
    .from("crawl_jobs")
    .select("status")
    .eq("id", id)
    .single();

  if (job && ["pending", "running"].includes(job.status)) {
    return NextResponse.json(
      { ok: false, error: "활성 상태의 작업은 삭제할 수 없습니다. 먼저 정지해주세요." },
      { status: 400 }
    );
  }

  const { error } = await supabase.from("crawl_jobs").delete().eq("id", id);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
