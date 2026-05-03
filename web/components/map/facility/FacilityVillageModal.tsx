"use client";

/**
 * 필지 마을 시설 리스트 모달 — FacilityVillageCard 의 [시설 N건 보기] 클릭 시 표시.
 *
 * OnbidVillageModal 직계 미러. 차이점:
 *   - 색상: rose → violet
 *   - 검색: 매물명 → 건물명/용도/지번
 *   - 정렬: 평수 내림 / 카테고리 / 사용승인일
 */

import { useEffect, useMemo, useState } from "react";
import type { FacilityListItem } from "@/lib/facility/enrich";
import type { FacilityVillageGroup } from "@/lib/facility/group";
import {
  FACILITY_CATEGORIES,
} from "@/lib/facility/classify";
import FacilityItemCard from "./FacilityItemCard";

type SortKey = "pyeong" | "category" | "useApr";

interface Props {
  group: FacilityVillageGroup;
  onClose: () => void;
  onItemClick: (item: FacilityListItem) => void;
}

export default function FacilityVillageModal({
  group,
  onClose,
  onItemClick,
}: Props) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("pyeong");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = group.items;
    if (q) {
      arr = arr.filter((it) => {
        const b = it.building;
        return (
          (b.bldNm ?? "").toLowerCase().includes(q) ||
          (b.mainPurpsCdNm ?? "").toLowerCase().includes(q) ||
          (b.etcPurps ?? "").toLowerCase().includes(q) ||
          (b.platPlc ?? "").toLowerCase().includes(q) ||
          FACILITY_CATEGORIES[it.category].label.toLowerCase().includes(q)
        );
      });
    }
    return [...arr].sort((a, b) => {
      if (sortKey === "pyeong") {
        return (b.pyeong ?? 0) - (a.pyeong ?? 0);
      }
      if (sortKey === "useApr") {
        return (b.building.useAprDay ?? "").localeCompare(
          a.building.useAprDay ?? "",
        );
      }
      // category
      return a.category.localeCompare(b.category);
    });
  }, [group.items, search, sortKey]);

  const locationName = [group.sd, group.sgg, group.emd]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 md:p-4">
      <div className="bg-white rounded-t-xl md:rounded-xl shadow-2xl w-full md:max-w-3xl h-[80dvh] md:h-auto md:max-h-[90vh] flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">
        {/* 헤더 */}
        <div className="px-3 py-2 md:px-5 md:py-4 border-b space-y-1.5 bg-violet-50">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-500 mb-0.5">필지 시설</div>
              <div className="text-sm md:text-base font-bold text-gray-900 truncate">
                {locationName}
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                {filtered.length.toLocaleString()}건
                {search && (
                  <span className="ml-1 text-gray-400">
                    (전체 {group.items.length.toLocaleString()}건)
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-10 h-10 md:w-9 md:h-9 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 text-2xl leading-none flex-shrink-0"
              aria-label="닫기"
            >
              ×
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="건물명, 용도, 지번 검색..."
              className="flex-1 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 border border-gray-300 rounded-md bg-white focus:outline-none focus:border-violet-500"
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="px-2 py-2 text-xs text-gray-700 border border-gray-300 rounded-md bg-white focus:outline-none focus:border-violet-500"
            >
              <option value="pyeong">평수순</option>
              <option value="category">카테고리순</option>
              <option value="useApr">최신순</option>
            </select>
          </div>
        </div>

        {/* 본문 */}
        <div className="overflow-auto flex-1 min-h-0 p-3 md:p-4 space-y-2.5">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">
              결과 없음
            </div>
          ) : (
            filtered.map((it, idx) => (
              <FacilityItemCard
                key={`${it.building.mgmBldrgstPk ?? idx}-${idx}`}
                index={idx + 1}
                item={it}
                onClick={onItemClick}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
