"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const BASE_NAV_ITEMS: NavItem[] = [
  // 엑셀 업로드는 현재 사용하지 않으므로 숨김 (페이지는 유지, /admin/upload 직접 접근 가능)
  // { href: "/admin/upload", label: "엑셀 업로드", icon: "📤" },
  { href: "/admin/crawl", label: "데이터 수집", icon: "🔄" },
  { href: "/admin/users", label: "계정 관리", icon: "👥" },
];

const LOCAL_ONLY_NAV_ITEMS: NavItem[] = [
  { href: "/admin/api-manager", label: "API 관리", icon: "🔧" },
];

interface Props {
  email: string;
  /** 로컬 환경 한정 메뉴 노출 여부 (layout 이 NODE_ENV + VERCEL 체크해 전달) */
  isLocal: boolean;
}

export default function AdminNav({ email, isLocal }: Props) {
  const NAV_ITEMS = isLocal ? [...BASE_NAV_ITEMS, ...LOCAL_ONLY_NAV_ITEMS] : BASE_NAV_ITEMS;
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
      {/* 상단 바 — 돌아가기 + 브랜드 + 사용자 */}
      <div className="px-6 py-3 flex items-center justify-between border-b border-gray-100 gap-4">
        <div className="flex items-center gap-3">
          {/* 지도로 돌아가기 — 명확한 파란 버튼 (구석으로 밀리지 않게 맨 앞) */}
          <Link
            href="/"
            className="group inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-500 hover:text-white border border-blue-200 hover:border-blue-500 px-3 py-1.5 rounded-md transition-colors"
            title="지도 화면으로 돌아가기"
          >
            <svg
              className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19l-7-7 7-7"
              />
            </svg>
            <span>지도로</span>
          </Link>

          <div className="w-px h-5 bg-gray-200" />

          <Link
            href="/"
            className="text-sm font-bold text-gray-900 hover:text-blue-600 flex items-center gap-1.5"
          >
            <span className="text-lg">🗺</span> KEPCO 배전선로 여유용량 지도
          </Link>
          <span className="text-[11px] px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">
            관리자
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600">{email}</span>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="text-xs text-gray-600 hover:text-gray-900 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-md disabled:opacity-50"
          >
            {loggingOut ? "로그아웃 중..." : "로그아웃"}
          </button>
        </div>
      </div>

      {/* 탭 메뉴 — 관리자 섹션 전환용만 (뒤로가기는 상단으로 분리) */}
      <nav className="px-6 flex items-center">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`text-sm px-4 py-2.5 flex items-center gap-1.5 border-b-2 transition-colors ${
                active
                  ? "border-blue-500 text-blue-600 font-semibold"
                  : "border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300"
              }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
