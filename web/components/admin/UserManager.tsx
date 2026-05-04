"use client";

import { useEffect, useState } from "react";

interface ManagedUser {
  id: string;
  email: string;
  role: "admin" | "viewer";
  displayName: string | null;
  createdAt: string;
  lastSignInAt: string | null;
}

interface Props {
  currentUserId: string;
}

export default function UserManager({ currentUserId }: Props) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showResetFor, setShowResetFor] = useState<ManagedUser | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "조회 실패");
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleRoleChange = async (user: ManagedUser, newRole: "admin" | "viewer") => {
    if (user.id === currentUserId && newRole === "viewer") {
      alert("본인의 관리자 권한은 해제할 수 없습니다.");
      return;
    }
    if (!confirm(`${displayLabel(user)} 님의 권한을 ${newRole === "admin" ? "관리자" : "일반"}로 변경할까요?`)) {
      return;
    }
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, role: newRole }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      fetchUsers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`변경 실패: ${msg}`);
    }
  };

  const handleDelete = async (user: ManagedUser) => {
    if (user.id === currentUserId) {
      alert("본인 계정은 삭제할 수 없습니다.");
      return;
    }
    if (!confirm(`${displayLabel(user)} 계정을 정말 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/users?userId=${encodeURIComponent(user.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      fetchUsers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`삭제 실패: ${msg}`);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500">
        사용자 목록을 불러오는 중...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div>
      {/* 액션 바 */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-gray-500">
          총 <span className="font-semibold text-gray-900">{users.length}명</span> ·
          관리자{" "}
          <span className="font-semibold text-blue-600">
            {users.filter((u) => u.role === "admin").length}
          </span>{" "}
          / 일반{" "}
          <span className="font-semibold text-gray-700">
            {users.filter((u) => u.role === "viewer").length}
          </span>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5"
        >
          <span>+</span> 계정 추가
        </button>
      </div>

      {/* 사용자 테이블 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b-2 border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-bold text-gray-700">아이디</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-gray-700">이름</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-gray-700">권한</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-gray-700">생성일</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-gray-700">최근 접속</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-gray-700">관리</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u, idx) => {
              const isMe = u.id === currentUserId;
              const displayId = u.email.endsWith("@kepco.local")
                ? u.email.replace("@kepco.local", "")
                : u.email;
              return (
                <tr
                  key={u.id}
                  className={`border-b border-gray-100 hover:bg-gray-50 ${
                    idx % 2 === 1 ? "bg-gray-50/40" : ""
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{displayId}</div>
                    {!u.email.endsWith("@kepco.local") && (
                      <div className="text-[10px] text-gray-400 mt-0.5">{u.email}</div>
                    )}
                    {isMe && (
                      <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 mt-0.5 font-medium">
                        나
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700 text-xs">
                    {u.displayName || <span className="text-gray-400">-</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block text-[11px] px-2 py-0.5 rounded font-medium ${
                        u.role === "admin"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {u.role === "admin" ? "관리자" : "일반"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {formatDate(u.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {u.lastSignInAt ? formatDate(u.lastSignInAt) : "-"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() =>
                          handleRoleChange(u, u.role === "admin" ? "viewer" : "admin")
                        }
                        disabled={isMe && u.role === "admin"}
                        className="text-[11px] text-gray-600 hover:text-blue-600 px-2 py-1 border border-gray-300 rounded hover:bg-blue-50 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        권한 변경
                      </button>
                      <button
                        onClick={() => setShowResetFor(u)}
                        className="text-[11px] text-gray-600 hover:text-blue-600 px-2 py-1 border border-gray-300 rounded hover:bg-blue-50"
                      >
                        비번 초기화
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        disabled={isMe}
                        className="text-[11px] text-red-600 hover:text-red-700 px-2 py-1 border border-red-200 rounded hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                  등록된 사용자가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 안내 */}
      <div className="mt-4 text-[11px] text-gray-500 space-y-1">
        <p>📌 회원가입 기능은 없습니다. 사용자에게 발급한 아이디와 비밀번호를 직접 전달해주세요.</p>
        <p>📌 본인 계정의 관리자 권한 해제 / 삭제는 차단됩니다.</p>
        <p>📌 비밀번호는 6자 이상이어야 합니다.</p>
      </div>

      {/* 모달들 */}
      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            fetchUsers();
          }}
        />
      )}

      {showResetFor && (
        <ResetPasswordModal
          user={showResetFor}
          onClose={() => setShowResetFor(null)}
          onDone={() => {
            setShowResetFor(null);
          }}
        />
      )}
    </div>
  );
}

function displayLabel(u: ManagedUser): string {
  if (u.displayName) return u.displayName;
  if (u.email.endsWith("@kepco.local")) return u.email.replace("@kepco.local", "");
  return u.email;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

// ─────────────────────────────────────────────
// 계정 추가 모달
// ─────────────────────────────────────────────
function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"admin" | "viewer">("viewer");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password, role, displayName }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
      >
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">새 계정 추가</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">
              아이디 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              required
              disabled={pending}
              className="w-full px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 border border-gray-300 rounded-md focus:outline-none focus:border-blue-500"
              placeholder="예: kim"
            />
            <p className="text-[10px] text-gray-500 mt-1">
              사용자는 이 아이디로 로그인합니다 (이메일 형식 입력 시 그대로 사용)
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">
              비밀번호 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={pending}
              className="w-full px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 border border-gray-300 rounded-md focus:outline-none focus:border-blue-500 font-mono"
              placeholder="6자 이상"
            />
            <p className="text-[10px] text-gray-500 mt-1">
              사용자에게 전달할 임시 비밀번호 (6자 이상)
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">표시 이름</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={pending}
              className="w-full px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 border border-gray-300 rounded-md focus:outline-none focus:border-blue-500"
              placeholder="예: 김부장 (선택)"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700 mb-1.5 block">권한</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRole("viewer")}
                className={`flex-1 px-3 py-2 text-xs rounded-md border ${
                  role === "viewer"
                    ? "bg-gray-700 border-gray-700 text-white font-medium"
                    : "bg-white border-gray-300 text-gray-600"
                }`}
              >
                일반 사용자 (조회만)
              </button>
              <button
                type="button"
                onClick={() => setRole("admin")}
                className={`flex-1 px-3 py-2 text-xs rounded-md border ${
                  role === "admin"
                    ? "bg-blue-500 border-blue-500 text-white font-medium"
                    : "bg-white border-gray-300 text-gray-600"
                }`}
              >
                관리자
              </button>
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t bg-gray-50 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2 border border-gray-300 rounded-md bg-white"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={pending || !loginId || !password}
            className="text-sm bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white font-medium px-4 py-2 rounded-md"
          >
            {pending ? "생성 중..." : "계정 생성"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────
// 비밀번호 초기화 모달
// ─────────────────────────────────────────────
function ResetPasswordModal({
  user,
  onClose,
  onDone,
}: {
  user: ManagedUser;
  onClose: () => void;
  onDone: () => void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, newPassword }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
      >
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">비밀번호 초기화</h3>
          <button
            type="button"
            onClick={done ? onDone : onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {done ? (
          <div className="p-5 space-y-3">
            <div className="text-sm text-gray-700">
              <span className="font-semibold">{displayLabel(user)}</span> 님의 비밀번호가
              초기화되었습니다.
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs">
              <div className="text-gray-600 mb-1">새 비밀번호:</div>
              <div className="font-mono text-base text-gray-900 select-all">
                {newPassword}
              </div>
            </div>
            <p className="text-[11px] text-gray-500">
              💡 사용자에게 새 비밀번호를 전달해주세요. 이 화면을 닫으면 다시 볼 수 없습니다.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={onDone}
                className="w-full text-sm bg-blue-500 hover:bg-blue-600 text-white font-medium px-4 py-2 rounded-md"
              >
                완료
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-5 space-y-4">
              <div className="text-sm text-gray-700">
                <span className="font-semibold">{displayLabel(user)}</span> 님의 비밀번호를
                초기화합니다.
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">
                  새 비밀번호 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  disabled={pending}
                  className="w-full px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 border border-gray-300 rounded-md focus:outline-none focus:border-blue-500 font-mono"
                  placeholder="6자 이상"
                />
              </div>
              {error && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {error}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t bg-gray-50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2 border border-gray-300 rounded-md bg-white"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={pending || !newPassword}
                className="text-sm bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white font-medium px-4 py-2 rounded-md"
              >
                {pending ? "처리 중..." : "초기화"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
