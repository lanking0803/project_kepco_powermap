"use client";

/**
 * 같은 동/리(BJD) 안 발전소 전체 목록 모달.
 * SolarSection 의 "[목록 보기]" 클릭 시 표시.
 *
 * LocationDetailModal(전기) 와 시각 일관성:
 *   - fixed inset-0 z-50 + 모바일 바텀시트 (Portal 로 transform 부모 탈출)
 *   - ESC 닫기
 *   - 번지 컬럼 좌측 + 📍 아이콘, 클릭 → 지번 흐름
 *   - 정렬 헤더 클릭으로 토글 (번지/용량/허가일)
 *
 * 차이:
 *   - 색상: emerald (태양광 일관) — 전기는 blue/emerald/amber 3분할
 *   - 컬럼: 번지 / 발전소명 / 용량 kW / 운영상태·허가일
 */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { SameDongRow } from "@/lib/api/solar-permits";

type SortKey = "jibun" | "facility" | "kw" | "status";
type SortDir = "asc" | "desc";

interface Props {
  areaLabel: string;
  rows: SameDongRow[];
  onClose: () => void;
  /** 행 클릭 콜백 — 받지 않으면 행 비활성. 견적 모드에서는 PNU 고정이라 미전달. */
  onPnuClick?: (pnu: string) => void;
}

export default function SolarListModal({
  areaLabel,
  rows,
  onClose,
  onPnuClick,
}: Props) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("kw");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  // Portal — ParcelInfoPanel 의 transform 부모(.kepco-slide-up) 에 갇히지 않도록 document.body 로 탈출.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setSort = (col: SortKey) => {
    if (sortKey === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      // 처음 클릭 시 컬럼별 직관적 기본 방향
      setSortDir(col === "jibun" || col === "facility" ? "asc" : "desc");
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = rows;
    if (q) {
      arr = arr.filter(
        (r) =>
          r.facility_name.toLowerCase().includes(q) ||
          r.jibun.includes(q) ||
          (r.operating_status ?? "").includes(q),
      );
    }
    const sorted = [...arr].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "kw") cmp = (a.capacity_kw ?? 0) - (b.capacity_kw ?? 0);
      else if (sortKey === "facility")
        cmp = a.facility_name.localeCompare(b.facility_name, "ko");
      else if (sortKey === "status")
        cmp = (a.operating_status ?? "").localeCompare(
          b.operating_status ?? "",
          "ko",
        );
      else cmp = a.jibun.localeCompare(b.jibun, "ko");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rows, search, sortKey, sortDir]);

  const totalKw = useMemo(
    () => Math.round(rows.reduce((s, r) => s + (r.capacity_kw ?? 0), 0)),
    [rows],
  );

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 md:p-4">
      <div className="bg-white rounded-t-xl md:rounded-xl shadow-2xl w-full md:max-w-2xl h-[80dvh] md:h-auto md:max-h-[90vh] flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">
        {/* 헤더 */}
        <div className="px-3 py-2 md:px-5 md:py-4 border-b bg-emerald-50">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-500 mb-0.5">태양광 발전소</div>
              <div className="text-sm md:text-base font-bold text-gray-900 truncate">
                {areaLabel || "이"} 일대
              </div>
              <div className="text-[11px] text-gray-600 mt-0.5">
                <b>{rows.length.toLocaleString()}</b>개 · 총{" "}
                <b className="text-emerald-700">{totalKw.toLocaleString()}</b> kW
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl leading-none shrink-0"
              aria-label="닫기"
            >
              ×
            </button>
          </div>

          {/* 검색 */}
          <div className="mt-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="발전소명·지번·운영상태 검색..."
              className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
            />
          </div>
        </div>

        {/* 본문 — 표 (LocationDetailModal 와 동일 패턴) */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm md:text-xs">
            <thead className="bg-gray-100 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-2 md:px-3 py-2 bg-gray-100 cursor-pointer w-32" onClick={() => setSort("jibun")}>
                  <SortHeaderInline label="번지" col="jibun" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className="px-2 md:px-3 py-2 bg-gray-100 cursor-pointer" onClick={() => setSort("facility")}>
                  <SortHeaderInline label="발전소명" col="facility" sortKey={sortKey} sortDir={sortDir} align="left" />
                </th>
                <th className="px-2 md:px-3 py-1.5 text-center text-xs md:text-[10px] font-bold text-emerald-800 bg-emerald-50 border-l border-r border-emerald-200 cursor-pointer w-24" onClick={() => setSort("kw")}>
                  <SortHeaderInline label="용량" col="kw" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className="px-2 md:px-3 py-1.5 text-center text-xs md:text-[10px] font-bold text-gray-700 bg-gray-50 cursor-pointer w-28" onClick={() => setSort("status")}>
                  <SortHeaderInline label="상태·허가" col="status" sortKey={sortKey} sortDir={sortDir} />
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-gray-400">
                    결과 없음
                  </td>
                </tr>
              ) : (
                filtered.map((row, idx) => (
                  <SolarRow
                    key={`${row.pnu}-${idx}`}
                    row={row}
                    idx={idx}
                    onPnuClick={onPnuClick}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 푸터 — 출처 */}
        <div className="px-3 py-1.5 md:px-5 border-t bg-gray-50 text-[10px] text-gray-400 text-right">
          전국태양광허가정보 (data.go.kr) · 매월 1일 갱신
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 정렬 가능 헤더 — LocationDetailModal 의 SortHeaderInline 와 같은 시각. */
function SortHeaderInline({
  label,
  col,
  sortKey,
  sortDir,
  align = "center",
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  align?: "left" | "center";
}) {
  const active = sortKey === col;
  return (
    <span
      className={`w-full h-full flex items-center gap-1 font-medium select-none ${
        align === "left" ? "justify-start" : "justify-center"
      } ${active ? "text-emerald-700" : "text-gray-600 hover:text-gray-900"}`}
    >
      {label}
      <span className="text-[10px]">{active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}</span>
    </span>
  );
}

/** 발전소 한 행 — LocationDetailModal 의 FragmentRow 와 동일 패턴. */
function SolarRow({
  row,
  idx,
  onPnuClick,
}: {
  row: SameDongRow;
  idx: number;
  onPnuClick?: (pnu: string) => void;
}) {
  const zebraBg = idx % 2 === 0 ? "bg-white" : "bg-gray-50/60";
  const clickable = !!onPnuClick;
  return (
    <tr className={`border-b border-gray-100 ${zebraBg}`}>
      <td className="px-2 md:px-3 py-2.5 font-semibold text-gray-900">
        {clickable ? (
          <button
            type="button"
            onClick={() => onPnuClick(row.pnu)}
            className="inline-flex items-center gap-1 px-2 py-1 -mx-1 rounded-md text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 active:bg-emerald-100 transition-colors"
            title="이 지번 상세정보 보기"
          >
            <span className="text-[10px]">📍</span>
            <span>{row.jibun}</span>
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-1 -mx-1 text-gray-700">
            <span className="text-[10px]">📍</span>
            <span>{row.jibun}</span>
          </span>
        )}
      </td>
      <td className="px-2 md:px-3 py-2.5 text-gray-900 truncate max-w-0">
        {row.facility_name}
      </td>
      <td className="px-2 md:px-3 py-2.5 text-center border-l border-r border-emerald-100 font-semibold text-emerald-700 tabular-nums">
        {row.capacity_kw != null ? `${row.capacity_kw.toLocaleString()} kW` : "-"}
      </td>
      <td className="px-2 md:px-3 py-2.5 text-center text-[11px] text-gray-600">
        <div className="truncate">{row.operating_status ?? "-"}</div>
        {row.permit_date && (
          <div className="text-[10px] text-gray-400 tabular-nums">
            {formatPermitDate(row.permit_date)}
          </div>
        )}
      </td>
    </tr>
  );
}

function formatPermitDate(dateStr: string): string {
  const m = dateStr.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}.${m[2]}` : dateStr;
}
