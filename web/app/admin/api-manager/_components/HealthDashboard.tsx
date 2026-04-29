"use client";

/**
 * 외부 서비스 헬스체크 대시보드 — 외부 탭 default 화면.
 *
 * 표시:
 *   - 8개 서비스 한눈 표 (이름 / 상태 / 응답시간 / 만료 D-day / 마지막 체크)
 *   - [▶ 전체 새로고침] 버튼 — 일괄 헬스체크 호출
 *   - 행 클릭 시 디테일 페이지로 이동 (?id=XXX)
 *
 * 헬스체크 상태:
 *   🟢 OK · 🟡 NODATA · 🔴 ERROR · ⚪ 미지원/미체크
 */

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CollectedExternalService } from "../_lib/types";
import type { ServiceHealthResult } from "@/app/api/admin/health-check-all/route";
import ExpiryBadge from "./ExpiryBadge";

interface Props {
  services: CollectedExternalService[];
}

export default function HealthDashboard({ services }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [results, setResults] = useState<Record<string, ServiceHealthResult>>({});
  const [loading, setLoading] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runHealthCheck() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/health-check-all", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "헬스체크 실패");
        return;
      }
      const map: Record<string, ServiceHealthResult> = {};
      for (const r of data.results as ServiceHealthResult[]) {
        map[r.serviceId] = r;
      }
      setResults(map);
      setLastCheckedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function jumpToService(serviceId: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("tab", "external");
    sp.set("id", serviceId);
    router.replace(`?${sp.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-gray-900">
            🩺 외부 서비스 헬스체크
          </h2>
          <div className="text-[11px] text-gray-500 mt-0.5">
            각 서비스의 sampleRequest 를 일괄 호출해 API 가 살아있는지 즉시 확인합니다.
            행을 클릭하면 디테일 페이지로 이동합니다.
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lastCheckedAt && (
            <span className="text-[11px] text-gray-500 tabular-nums">
              {new Date(lastCheckedAt).toLocaleTimeString("ko-KR")}
            </span>
          )}
          <button
            onClick={runHealthCheck}
            disabled={loading}
            className={`text-xs px-3 py-1.5 rounded font-semibold transition-colors ${
              loading
                ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {loading ? "체크 중..." : "🔄 전체 새로고침"}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* 헬스체크 표 */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr className="text-left">
              <th className="px-3 py-2 font-semibold">서비스</th>
              <th className="px-3 py-2 font-semibold w-24">상태</th>
              <th className="px-3 py-2 font-semibold w-20 text-right">응답시간</th>
              <th className="px-3 py-2 font-semibold w-32">키 만료</th>
              <th className="px-3 py-2 font-semibold w-28">결과 요약</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {services.map((s) => {
              const r = results[s.id];
              return (
                <tr
                  key={s.id}
                  onClick={() => jumpToService(s.id)}
                  className="hover:bg-blue-50 cursor-pointer transition-colors"
                  title="클릭 시 디테일 페이지로 이동"
                >
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-gray-900">{s.name}</div>
                    <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                      {s.id} · {s.consumedBy.length} consumer
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <HealthBadge result={r} loading={loading} />
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {r ? (
                      <span className={elapsedColor(r.elapsedMs)}>
                        {r.elapsedMs.toFixed(0)} ms
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <ExpiryBadge expiry={s.expiry} />
                  </td>
                  <td className="px-3 py-2.5 text-gray-700 text-[11px]">
                    {r ? r.summary : <span className="text-gray-300">대기 중</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 안내 */}
      <div className="text-[11px] text-gray-500 leading-relaxed">
        <div>
          <span className="font-semibold">🟢 OK</span> = 200 응답 + 데이터 정상 ·{" "}
          <span className="font-semibold">🟡 NODATA</span> = 200 응답이지만 결과 0건
          (파라미터/필터 검토 필요) ·{" "}
          <span className="font-semibold">🔴 ERROR</span> = 네트워크 또는 4xx/5xx ·{" "}
          <span className="font-semibold">⚪ 미지원</span> = sampleRequest 미정의
        </div>
      </div>
    </div>
  );
}

function HealthBadge({
  result,
  loading,
}: {
  result: ServiceHealthResult | undefined;
  loading: boolean;
}) {
  if (!result) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
        <span className="w-2 h-2 rounded-full bg-gray-300" />
        {loading ? "체크 중" : "대기"}
      </span>
    );
  }
  const map: Record<
    string,
    { color: string; bg: string; label: string }
  > = {
    ok: { color: "text-green-700", bg: "bg-green-500", label: "OK" },
    nodata: { color: "text-amber-700", bg: "bg-amber-400", label: "NODATA" },
    error: { color: "text-red-700", bg: "bg-red-500", label: "ERROR" },
    unsupported: { color: "text-gray-500", bg: "bg-gray-300", label: "미지원" },
  };
  const v = map[result.healthLevel] ?? map.unsupported;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${v.color}`}>
      <span className={`w-2 h-2 rounded-full ${v.bg}`} />
      {v.label}
    </span>
  );
}

function elapsedColor(ms: number): string {
  if (ms === 0) return "text-gray-400";
  if (ms >= 2000) return "text-red-600 font-semibold";
  if (ms >= 500) return "text-amber-700";
  return "text-green-700";
}
