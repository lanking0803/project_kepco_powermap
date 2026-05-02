"use client";

/**
 * 자연취락지구 모드 검색 패널 — Sidebar 안에 inline 으로 들어감.
 *
 * 외곽 컨테이너/헤더는 부모 Sidebar 가 제공 (= OnbidSearchPanel 패턴 미러).
 * 본 컴포넌트는 검색 입력 + (다음 단계) 결과 카드 리스트만 담당.
 *
 * 데이터 소스:
 *   - 시도/시군구 드롭다운 = totalRows (MapSummaryRow[]) 에서 동적 derive.
 *     KEPCO 데이터가 있는 시군구만 노출 — 없는 시군구는 영업 의미 0 (자연 사전 필터).
 *   - 사용자는 한글로 선택, API 호출은 sigunguCode (bjd_code 앞 5자리) 사용.
 *   - 검색 = /api/uq-villages/by-bjd?bjd_code=... (다음 단계에서 연결)
 *
 * ⚠️ 본 커밋은 입력 UI만. 실제 검색/결과/지도 렌더는 다음 단계.
 */

import { useEffect, useMemo, useState } from "react";
import {
  loadModeState,
  saveModeState,
  clearModeState,
} from "@/lib/modes/storage";
import {
  UQ_EMPTY_PARAMS,
  type UqPersistedState,
  type UqSearchParams,
} from "@/lib/modes/modes/uq";
import type { MapSummaryRow } from "@/lib/types";

const MODE_ID = "uq";

interface Props {
  /** 지도 마커 원본 — 시도/시군구 드롭다운 derive 출처 */
  totalRows: MapSummaryRow[];
  /** 검색 결과 변경 — 지도 마커/폴리곤 갱신용 (다음 단계) */
  onResults?: (items: unknown[]) => void;
  /** 결과 카드 클릭 — 지도 강조 + 마을 진입 (다음 단계) */
  onItemClick?: (item: unknown) => void;
}

/** "수원시" + "권선구" → "수원시 권선구" / 한쪽만 있으면 그것만 */
function formatSigungu(addrSi: string | null, addrGu: string | null): string {
  return [addrSi, addrGu].filter((s): s is string => !!s && s.trim() !== "").join(" ");
}

export default function UqVillageSearchPanel({ totalRows }: Props) {
  const persisted =
    typeof window !== "undefined"
      ? loadModeState<UqPersistedState>(MODE_ID)
      : null;

  const [params, setParams] = useState<UqSearchParams>(
    persisted?.params ?? UQ_EMPTY_PARAMS,
  );

  /** 시도 목록 — KEPCO 데이터 있는 시도만, 알파벳 순. */
  const sidos = useMemo(() => {
    const set = new Set<string>();
    for (const r of totalRows) {
      if (r.addr_do) set.add(r.addr_do);
    }
    return [...set].sort();
  }, [totalRows]);

  /**
   * 선택된 시도의 시군구 목록 — { label: 한글, code: bjd 앞 5자리 } 짝.
   * 같은 시군구 행이 여러 개라도 1번만 노출. 코드는 첫 행 기준 (모두 동일).
   */
  const sigungus = useMemo(() => {
    if (!params.sido) return [] as Array<{ label: string; code: string }>;
    const map = new Map<string, string>(); // label -> code
    for (const r of totalRows) {
      if (r.addr_do !== params.sido) continue;
      const label = formatSigungu(r.addr_si, r.addr_gu);
      if (!label) continue;
      if (!map.has(label)) {
        // bjd_code 10자리 → 시군구 5자리
        const code = (r.bjd_code || "").slice(0, 5);
        if (/^\d{5}$/.test(code)) map.set(label, code);
      }
    }
    return [...map.entries()]
      .map(([label, code]) => ({ label, code }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [totalRows, params.sido]);

  /** 시도 변경 시 — 선택했던 시군구가 새 시도에 없으면 초기화. */
  useEffect(() => {
    if (!params.sigungu) return;
    const stillValid = sigungus.some((s) => s.label === params.sigungu);
    if (!stillValid) {
      setParams((p) => ({ ...p, sigungu: "", sigunguCode: "" }));
    }
  }, [sigungus, params.sigungu]);

  const canSearch = params.sigunguCode !== "";

  const runSearch = () => {
    if (!canSearch) return;
    // TODO(다음 단계): /api/uq-villages/by-bjd?bjd_code=${params.sigunguCode + "00000"}
    //   호출 + 결과 카드 + 지도 폴리곤 렌더.
    saveModeState<UqPersistedState>(MODE_ID, { params, results: [] });
  };

  const reset = () => {
    setParams(UQ_EMPTY_PARAMS);
    clearModeState(MODE_ID);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 space-y-3 overflow-y-auto flex-shrink-0 border-b border-gray-100">
        <Section title="지역">
          <div className="space-y-1.5">
            <Field label="시도">
              <select
                value={params.sido}
                onChange={(e) =>
                  setParams((p) => ({
                    ...p,
                    sido: e.target.value,
                    sigungu: "",
                    sigunguCode: "",
                  }))
                }
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-emerald-500 focus:outline-none"
              >
                <option value="">선택</option>
                {sidos.map((sd) => (
                  <option key={sd} value={sd}>
                    {sd}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="시군구">
              <select
                value={params.sigungu}
                disabled={!params.sido}
                onChange={(e) => {
                  const label = e.target.value;
                  const found = sigungus.find((s) => s.label === label);
                  setParams((p) => ({
                    ...p,
                    sigungu: label,
                    sigunguCode: found?.code ?? "",
                  }));
                }}
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-emerald-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">
                  {params.sido ? "선택" : "(시도 먼저 선택)"}
                </option>
                {sigungus.map((s) => (
                  <option key={s.code} value={s.label}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        <p className="text-[11px] text-gray-500 leading-relaxed">
          🏘 자연취락지구 — 건폐율 60% 적용 영역. 창고/태양광 영업 1차 발굴용.
          시군구 단위로 검색합니다.
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={runSearch}
            disabled={!canSearch}
            className="flex-1 py-2 rounded-md bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            🔍 검색
          </button>
          <button
            type="button"
            onClick={reset}
            className="px-3 py-2 rounded-md border border-gray-300 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            초기화
          </button>
        </div>
      </div>

      {/* 결과 영역 — 다음 단계에서 채움 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        <p className="text-xs text-gray-400 text-center py-8">
          검색 결과는 다음 단계에서 표시됩니다.
        </p>
      </div>
    </div>
  );
}

/* ── 작은 보조 컴포넌트 — OnbidSearchPanel 과 모양 통일을 위해 inline ── */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] font-bold text-gray-700 mb-1">{title}</div>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-gray-500 w-12 flex-shrink-0">
        {label}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
