"use client";

/**
 * 자연취락지구 모드 검색 패널 — Sidebar 안에 inline 으로 들어감.
 *
 * 외곽 컨테이너/헤더는 부모 Sidebar 가 제공 (= OnbidSearchPanel 패턴 미러).
 * 본 컴포넌트는 검색 입력 + (다음 단계) 결과 카드 리스트만 담당.
 *
 * 데이터: /api/uq-villages/by-bjd 호출 — 시군구 단위 응답.
 *   ⚠️ 본 커밋은 UI 골격만. 실제 검색/결과/지도 연동은 다음 단계.
 */

import { useState } from "react";
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
import { SIDOS } from "@/lib/modes/region";

const MODE_ID = "uq";

interface Props {
  /** 검색 결과 변경 — 지도 마커/폴리곤 갱신용 (다음 단계) */
  onResults?: (items: unknown[]) => void;
  /** 결과 카드 클릭 — 지도 강조 + 마을 진입 (다음 단계) */
  onItemClick?: (item: unknown) => void;
}

export default function UqVillageSearchPanel(_props: Props) {
  const persisted =
    typeof window !== "undefined"
      ? loadModeState<UqPersistedState>(MODE_ID)
      : null;

  const [params, setParams] = useState<UqSearchParams>(
    persisted?.params ?? UQ_EMPTY_PARAMS,
  );

  const canSearch = params.sido.trim() !== "" && params.sigungu.trim() !== "";

  const runSearch = () => {
    if (!canSearch) return;
    // TODO(다음 단계): /api/uq-villages/by-bjd 호출 + 결과 표시 + 지도 폴리곤 렌더
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
                  setParams((p) => ({ ...p, sido: e.target.value }))
                }
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-emerald-500 focus:outline-none"
              >
                <option value="">전체</option>
                {SIDOS.map((sd) => (
                  <option key={sd} value={sd}>
                    {sd}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="시군구">
              <input
                type="text"
                placeholder="예: 곡성군"
                value={params.sigungu}
                onChange={(e) =>
                  setParams((p) => ({ ...p, sigungu: e.target.value }))
                }
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-emerald-500 focus:outline-none"
              />
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
