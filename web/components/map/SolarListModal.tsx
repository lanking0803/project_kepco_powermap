"use client";

/**
 * 같은 동/리(BJD) 안 발전소 전체 목록 모달.
 * SolarSection 의 "[목록 보기]" 클릭 시 표시.
 *
 * OnbidVillageModal / LocationDetailModal 와 시각 일관성:
 *   - fixed inset-0 z-50 + 모바일 바텀시트
 *   - ESC 닫기
 *   - 헤더 (주소 + 닫기) + 검색/정렬 행
 *
 * 차이:
 *   - 색상: emerald (태양광 일관)
 *   - 검색: 발전소명 / 지번 / 운영상태
 *   - 정렬: 용량(기본) / 허가일 / 지번
 *   - 좌표 미보유 행: 흐리게 + ⚠ 좌표 정보 미제공 안내
 */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { SameDongRow } from "@/lib/api/solar-permits";

type SortKey = "kw" | "permit" | "jibun";

interface Props {
  areaLabel: string;
  rows: SameDongRow[];
  onClose: () => void;
  /** 행 클릭 콜백 — 받지 않으면 행은 비활성(시각 동일, 클릭 X). 견적 모드에서는 PNU 고정이라 미전달. */
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
  // Portal — ParcelInfoPanel 의 transform 부모에 갇히지 않도록 document.body 로 탈출.
  // SSR 안전을 위해 mounted 후에만 렌더.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    return [...arr].sort((a, b) => {
      if (sortKey === "kw") return (b.capacity_kw ?? 0) - (a.capacity_kw ?? 0);
      if (sortKey === "permit") {
        const ad = a.permit_date ?? "";
        const bd = b.permit_date ?? "";
        return bd.localeCompare(ad);
      }
      return a.jibun.localeCompare(b.jibun, "ko");
    });
  }, [rows, search, sortKey]);

  const totalKw = useMemo(
    () => Math.round(rows.reduce((s, r) => s + (r.capacity_kw ?? 0), 0)),
    [rows],
  );
  const withCoord = useMemo(
    () => rows.filter((r) => r.lat != null && r.lng != null).length,
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
                {withCoord < rows.length && (
                  <span className="text-gray-400 ml-1">
                    · 지도 표시 가능 {withCoord}개
                  </span>
                )}
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

          {/* 검색/정렬 — 1행 */}
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="발전소명·지번·운영상태"
              className="flex-1 min-w-0 text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-400"
            >
              <option value="kw">용량 ↓</option>
              <option value="permit">허가일 ↓</option>
              <option value="jibun">지번 ↑</option>
            </select>
          </div>
        </div>

        {/* 본문 — 카드 리스트 */}
        <div className="flex-1 overflow-auto px-3 py-2 md:px-5 md:py-3">
          {filtered.length === 0 ? (
            <div className="text-xs text-gray-500 py-6 text-center">
              검색 결과 없음
            </div>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((row, i) => (
                <SolarListRow
                  key={`${row.pnu}-${i}`}
                  row={row}
                  onPnuClick={onPnuClick}
                />
              ))}
            </div>
          )}
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

function SolarListRow({
  row,
  onPnuClick,
}: {
  row: SameDongRow;
  onPnuClick?: (pnu: string) => void;
}) {
  const hasCoord = row.lat != null && row.lng != null;
  const clickable = !!onPnuClick;
  const Tag = clickable ? "button" : "div";
  return (
    <Tag
      type={clickable ? "button" : undefined}
      onClick={clickable ? () => onPnuClick(row.pnu) : undefined}
      className={`block w-full text-left border rounded px-2.5 py-1.5 transition-colors ${
        hasCoord
          ? "bg-emerald-50/50 border-emerald-200"
          : "bg-gray-50 border-gray-200"
      } ${clickable ? "hover:bg-emerald-100 hover:border-emerald-400 cursor-pointer" : ""}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-semibold text-gray-900 truncate">
          {row.facility_name}
        </div>
        <div className="text-[11px] text-gray-500 tabular-nums shrink-0">
          {row.jibun}
        </div>
      </div>
      <div className="text-[11px] text-gray-600 mt-0.5 flex flex-wrap items-center gap-x-1">
        {row.capacity_kw != null && (
          <span className="font-semibold text-emerald-700">
            {row.capacity_kw.toLocaleString()} kW
          </span>
        )}
        {row.operating_status && (
          <>
            <span className="text-gray-300">·</span>
            <span>{row.operating_status}</span>
          </>
        )}
        {row.permit_date && (
          <>
            <span className="text-gray-300">·</span>
            <span>{formatPermitDate(row.permit_date)}</span>
          </>
        )}
        {!hasCoord && (
          <>
            <span className="text-gray-300">·</span>
            <span className="text-gray-400">⚠ 좌표 미제공</span>
          </>
        )}
      </div>
    </Tag>
  );
}

function formatPermitDate(dateStr: string): string {
  const m = dateStr.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}.${m[2]}` : dateStr;
}
