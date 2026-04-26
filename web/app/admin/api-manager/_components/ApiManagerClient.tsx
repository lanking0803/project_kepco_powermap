"use client";

/**
 * API 관리 콘솔 — 메인 클라이언트 컴포넌트.
 *
 * 역할:
 *   - 탭 전환 (외부 ↔ 내부)
 *   - 좌우 분할 레이아웃
 *   - 선택된 항목에 따라 ServicePanel 또는 EndpointPanel 렌더
 *   - URL searchParams 와 동기화
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import type {
  CollectedEndpoint,
  CollectedExternalService,
  HttpMethod,
} from "../_lib/types";
import type { KeyStatusPublic } from "../_lib/server-keys";
import CategoryNav from "./CategoryNav";
import ServicePanel from "./ServicePanel";
import EndpointPanel from "./EndpointPanel";

type Tab = "external" | "internal";

interface Props {
  initialTab: Tab;
  initialId: string | null;
  initialMethod: HttpMethod | null;
  endpoints: CollectedEndpoint[];
  services: CollectedExternalService[];
  /** serviceId → KeyStatusPublic[] (raw 키는 server-only, 여기서는 마스킹/등록상태만) */
  keyMap: Record<string, KeyStatusPublic[]>;
  warnings: string[];
}

export default function ApiManagerClient({
  initialTab,
  initialId,
  initialMethod,
  endpoints,
  services,
  keyMap,
  warnings,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tab: Tab = (searchParams.get("tab") as Tab) || initialTab;
  const id = searchParams.get("id") || initialId;
  const method = (searchParams.get("method") as HttpMethod) || initialMethod;

  const selectedService = useMemo(
    () => (tab === "external" ? services.find((s) => s.id === id) ?? null : null),
    [tab, id, services],
  );
  const selectedEndpoint = useMemo(
    () => (tab === "internal" ? endpoints.find((e) => e.id === id) ?? null : null),
    [tab, id, endpoints],
  );

  function switchTab(next: Tab) {
    const sp = new URLSearchParams();
    sp.set("tab", next);
    router.replace(`?${sp.toString()}`, { scroll: false });
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      {/* 탭 헤더 */}
      <div className="flex items-center border-b border-gray-200 bg-gray-50">
        <TabButton active={tab === "external"} onClick={() => switchTab("external")}>
          🌐 외부 서비스
          <span className="ml-1.5 text-[10px] text-gray-500">({services.length})</span>
        </TabButton>
        <TabButton active={tab === "internal"} onClick={() => switchTab("internal")}>
          🛠 내부 API
          <span className="ml-1.5 text-[10px] text-gray-500">({endpoints.length})</span>
        </TabButton>
        {warnings.length > 0 && (
          <div className="ml-auto px-3 py-2 text-[11px] text-amber-700">
            ⚠ {warnings.length} 경고
          </div>
        )}
      </div>

      {/* 좌우 분할 — 좌 280px / 우 flex */}
      <div className="grid grid-cols-[280px_1fr] min-h-[600px]">
        <div className="border-r border-gray-200 bg-gray-50/40">
          <CategoryNav
            tab={tab}
            selectedId={id}
            services={services}
            endpoints={endpoints}
          />
        </div>

        <div className="p-5 overflow-y-auto">
          {tab === "external" && selectedService && (
            <ServicePanel
              service={selectedService}
              envKeys={keyMap[selectedService.id] ?? []}
            />
          )}
          {tab === "internal" && selectedEndpoint && (
            <EndpointPanel endpoint={selectedEndpoint} selectedMethod={method} />
          )}
          {!selectedService && !selectedEndpoint && (
            <EmptyState tab={tab} />
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-blue-500 text-blue-600 bg-white"
          : "border-transparent text-gray-600 hover:text-gray-900 hover:bg-white/60"
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 py-20">
      <div className="text-4xl mb-3">{tab === "external" ? "🌐" : "🛠"}</div>
      <div className="text-sm">
        좌측에서 {tab === "external" ? "외부 서비스" : "내부 API"} 를 선택하세요.
      </div>
    </div>
  );
}
