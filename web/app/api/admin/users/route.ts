/**
 * 관리자 전용 — 사용자 CRUD
 *
 * GET    /api/admin/users          → 전체 사용자 목록
 * POST   /api/admin/users          → 새 사용자 생성 (loginId, password, role, displayName)
 * PATCH  /api/admin/users          → 권한 / 표시 이름 변경 (userId, role?, displayName?)
 * DELETE /api/admin/users?userId=  → 사용자 삭제
 * PUT    /api/admin/users          → 비밀번호 초기화 (userId, newPassword)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, listAllUsers } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EndpointMeta } from "@/app/admin/api-manager/_lib/types";

export const metaGET: EndpointMeta = {
  source: "Supabase Auth admin.listUsers + user_roles join",
  cache: "no-store",
  auth: "admin",
  inputs: [],
  outputSchema: "{ ok, users: Array<{ id, email, role, displayName, created_at }> }",
  externalDeps: ["supabase"],
  notes: "전체 사용자 목록.",
};

export const metaPOST: EndpointMeta = {
  source: "Supabase Auth admin.createUser + user_roles insert",
  cache: "no-store",
  auth: "admin",
  inputs: [
    { name: "loginId", type: "string", required: true, sample: "newuser", description: "로그인 ID (자동으로 @kepco.local 붙음)" },
    { name: "password", type: "string", required: true, sample: "TestPw12!", description: "초기 비밀번호" },
    { name: "role", type: "string", required: false, sample: "viewer", description: "admin | viewer (기본 viewer)" },
    { name: "displayName", type: "string", required: false, sample: "홍길동" },
  ],
  outputSchema: "{ ok, user: { id, email, role, displayName } }",
  externalDeps: ["supabase"],
  notes: "loginId 에 @ 없으면 @kepco.local 자동 부착 (LoginForm 과 동일 규칙).",
};

export const metaPATCH: EndpointMeta = {
  source: "DB update (user_roles)",
  cache: "no-store",
  auth: "admin",
  inputs: [
    { name: "userId", type: "string", required: true, sample: "uuid-xxxx", description: "Supabase user.id" },
    { name: "role", type: "string", required: false, sample: "admin" },
    { name: "displayName", type: "string", required: false, sample: "홍길동" },
  ],
  outputSchema: "{ ok }",
  externalDeps: ["supabase"],
  notes: "권한 / 표시 이름 변경.",
};

export const metaDELETE: EndpointMeta = {
  source: "Supabase Auth admin.deleteUser",
  cache: "no-store",
  auth: "admin",
  inputs: [
    { name: "userId", type: "string", required: true, sample: "uuid-xxxx", description: "Supabase user.id (querystring)" },
  ],
  outputSchema: "{ ok }",
  externalDeps: ["supabase"],
  dangerous: true,
  dangerNote:
    "사용자 영구 삭제 — 복구 불가. 해당 사용자의 모든 세션 무효화.",
  notes: "삭제 후 user_roles cascade 가 함께 정리.",
};

export const metaPUT: EndpointMeta = {
  source: "Supabase Auth admin.updateUserById (password 만)",
  cache: "no-store",
  auth: "admin",
  inputs: [
    { name: "userId", type: "string", required: true, sample: "uuid-xxxx" },
    { name: "newPassword", type: "string", required: true, sample: "NewPw34!", description: "새 비밀번호" },
  ],
  outputSchema: "{ ok }",
  externalDeps: ["supabase"],
  dangerous: true,
  dangerNote: "사용자 비밀번호 강제 초기화. 관리자가 사용자에게 새 비밀번호 직접 전달 필요.",
  notes: "사용자가 비밀번호를 잊은 경우 관리자가 초기화.",
};

/** 로그인 ID → 이메일 변환 (LoginForm과 동일 규칙) */
function toEmail(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes("@")) return trimmed;
  return `${trimmed}@kepco.local`;
}

// ─────────────────────────────────────────────
// GET — 사용자 목록
// ─────────────────────────────────────────────
export async function GET() {
  const me = await requireAdmin();
  if (!me) {
    return NextResponse.json(
      { ok: false, error: "관리자만 접근 가능합니다." },
      { status: 403 }
    );
  }

  try {
    const users = await listAllUsers();
    return NextResponse.json({ ok: true, users });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────
// POST — 새 사용자 생성
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
    loginId: string;
    password: string;
    role: "admin" | "viewer";
    displayName?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 요청" }, { status: 400 });
  }

  // 검증
  if (!body.loginId?.trim()) {
    return NextResponse.json({ ok: false, error: "아이디를 입력해주세요." }, { status: 400 });
  }
  if (!body.password || body.password.length < 6) {
    return NextResponse.json(
      { ok: false, error: "비밀번호는 6자 이상이어야 합니다." },
      { status: 400 }
    );
  }
  if (body.role !== "admin" && body.role !== "viewer") {
    return NextResponse.json(
      { ok: false, error: "권한은 admin 또는 viewer여야 합니다." },
      { status: 400 }
    );
  }

  const email = toEmail(body.loginId);
  const supabase = createAdminClient();

  // 1) Supabase Auth 사용자 생성
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password: body.password,
    email_confirm: true, // 인증 없이 즉시 활성
  });

  if (createErr || !created?.user) {
    const msg = createErr?.message || "사용자 생성 실패";
    // 친절 메시지 변환
    let userMsg = msg;
    if (msg.toLowerCase().includes("already")) {
      userMsg = "이미 사용 중인 아이디입니다.";
    } else if (msg.toLowerCase().includes("password")) {
      userMsg = "비밀번호가 정책에 맞지 않습니다 (6자 이상).";
    }
    return NextResponse.json({ ok: false, error: userMsg }, { status: 400 });
  }

  // 2) user_roles 추가
  const { error: roleErr } = await supabase.from("user_roles").insert({
    user_id: created.user.id,
    role: body.role,
    display_name: body.displayName?.trim() || null,
  });

  if (roleErr) {
    // 롤백: Auth 사용자 삭제
    await supabase.auth.admin.deleteUser(created.user.id);
    return NextResponse.json(
      { ok: false, error: `권한 등록 실패: ${roleErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    user: {
      id: created.user.id,
      email,
      role: body.role,
      displayName: body.displayName ?? null,
    },
  });
}

// ─────────────────────────────────────────────
// PATCH — 권한 / 표시 이름 변경
// ─────────────────────────────────────────────
export async function PATCH(request: NextRequest) {
  const me = await requireAdmin();
  if (!me) {
    return NextResponse.json(
      { ok: false, error: "관리자만 접근 가능합니다." },
      { status: 403 }
    );
  }

  let body: { userId: string; role?: "admin" | "viewer"; displayName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 요청" }, { status: 400 });
  }

  if (!body.userId) {
    return NextResponse.json({ ok: false, error: "userId 필요" }, { status: 400 });
  }

  // 본인이 본인 권한을 viewer로 강등하면 admin이 0명이 될 수 있음 — 차단
  if (body.userId === me.id && body.role === "viewer") {
    return NextResponse.json(
      { ok: false, error: "본인의 관리자 권한은 해제할 수 없습니다." },
      { status: 400 }
    );
  }

  const update: { role?: string; display_name?: string | null } = {};
  if (body.role) update.role = body.role;
  if (body.displayName !== undefined) {
    update.display_name = body.displayName.trim() || null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { ok: false, error: "변경할 내용이 없습니다." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("user_roles")
    .update(update)
    .eq("user_id", body.userId);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// ─────────────────────────────────────────────
// DELETE — 사용자 삭제
// ─────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  const me = await requireAdmin();
  if (!me) {
    return NextResponse.json(
      { ok: false, error: "관리자만 접근 가능합니다." },
      { status: 403 }
    );
  }

  const userId = request.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ ok: false, error: "userId 필요" }, { status: 400 });
  }
  if (userId === me.id) {
    return NextResponse.json(
      { ok: false, error: "본인 계정은 삭제할 수 없습니다." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  // user_roles는 ON DELETE CASCADE로 자동 삭제됨
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// ─────────────────────────────────────────────
// PUT — 비밀번호 초기화
// ─────────────────────────────────────────────
export async function PUT(request: NextRequest) {
  const me = await requireAdmin();
  if (!me) {
    return NextResponse.json(
      { ok: false, error: "관리자만 접근 가능합니다." },
      { status: 403 }
    );
  }

  let body: { userId: string; newPassword: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 요청" }, { status: 400 });
  }

  if (!body.userId || !body.newPassword) {
    return NextResponse.json(
      { ok: false, error: "userId와 newPassword가 필요합니다." },
      { status: 400 }
    );
  }
  if (body.newPassword.length < 6) {
    return NextResponse.json(
      { ok: false, error: "비밀번호는 6자 이상이어야 합니다." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const { error } = await supabase.auth.admin.updateUserById(body.userId, {
    password: body.newPassword,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
