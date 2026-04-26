"use client";

/**
 * 좌측 카테고리 트리 네비.
 *
 * 외부 탭: meta.category 별 그룹 (geocoding / data.go.kr / infra / scraping)
 * 내부 탭: path 첫 세그먼트 별 그룹 (capa / parcel / admin / ...)
 *
 * URL 라우팅: 클릭 시 router.replace(?tab=X&id=Y) — 새로고침/뒤로가기 지원
 */

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  CollectedEndpoint,
  CollectedExternalService,
} from "../_lib/types";

type Tab = "external" | "internal";

interface Props {
  tab: Tab;
  selectedId: string | null;
  services: CollectedExternalService[];
  endpoints: CollectedEndpoint[];
}

export default function CategoryNav({ tab, selectedId, services, endpoints }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (tab === "external") {
      return services.filter((s) =>
        !q ||
        s.id.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q),
      );
    }
    return endpoints.filter((e) =>
      !q ||
      e.id.toLowerCase().includes(q) ||
      e.path.toLowerCase().includes(q),
    );
  }, [tab, query, services, endpoints]);

  const grouped = useMemo(() => {
    if (tab === "external") {
      const m = new Map<string, CollectedExternalService[]>();
      for (const s of filteredItems as CollectedExternalService[]) {
        const k = s.category;
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(s);
      }
      return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
    } else {
      const m = new Map<string, CollectedEndpoint[]>();
      for (const e of filteredItems as CollectedEndpoint[]) {
        const segments = e.path.replace(/^\/api\/?/, "").split("/");
        const k = segments[0] || "(root)";
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(e);
      }
      return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
    }
  }, [tab, filteredItems]);

  function handleSelect(id: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("tab", tab);
    sp.set("id", id);
    sp.delete("method");
    router.replace(`?${sp.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-200">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === "external" ? "서비스 검색…" : "endpoint 검색…"}
          className="w-full text-xs px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {grouped.length === 0 && (
          <div className="px-3 py-4 text-xs text-gray-400 text-center">
            검색 결과 없음
          </div>
        )}
        {grouped.map(([groupKey, items]) => (
          <div key={groupKey} className="border-b border-gray-100 last:border-b-0">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide bg-gray-50">
              {groupKey} ({items.length})
            </div>
            {tab === "external"
              ? (items as CollectedExternalService[]).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleSelect(s.id)}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-blue-50 border-l-2 transition-colors ${
                      selectedId === s.id
                        ? "border-blue-500 bg-blue-50 font-semibold text-blue-700"
                        : "border-transparent text-gray-700"
                    }`}
                  >
                    <div className="truncate">{s.name}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5 truncate">
                      {s.id} · {s.consumedBy.length} consumer
                    </div>
                  </button>
                ))
              : (items as CollectedEndpoint[]).map((e) => {
                  const methodCount = e.methods.length;
                  const methodLabel = e.methods.map((m) => m.method).join("/");
                  return (
                    <button
                      key={e.id}
                      onClick={() => handleSelect(e.id)}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-blue-50 border-l-2 transition-colors ${
                        selectedId === e.id
                          ? "border-blue-500 bg-blue-50 font-semibold text-blue-700"
                          : "border-transparent text-gray-700"
                      }`}
                    >
                      <div className="font-mono truncate">{e.path}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">
                        {methodLabel} {methodCount > 1 && `(${methodCount})`}
                      </div>
                    </button>
                  );
                })}
          </div>
        ))}
      </div>
    </div>
  );
}
