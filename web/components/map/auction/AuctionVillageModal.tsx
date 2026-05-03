"use client";

/**
 * 경매 마을 매물 리스트 모달 — AuctionVillageCard 의 [매물 N건 보기] 클릭 시 표시.
 *
 * OnbidVillageModal 미러 — 색상은 amber, 정렬키는 경매 특성 반영.
 *
 * 영업담당자 시각의 정렬:
 *   - D-day↑ (임박 우선) — 입찰 등록 마감 다가오는 매물
 *   - 할인율↓ (저가 우선) — 감정가 대비 깊게 빠진 매물
 *   - 감정가↓ (고가 우선) — 굵직한 매물
 *   - 신건 우선 — 새 매물 영업 매력
 *
 * 검색: 사건명칭 / 용도 / 대표소재지 (Hyphen 매물 식별 우선순위).
 */

import { useEffect, useMemo, useState } from "react";
import type { AuctionListItem } from "@/lib/hyphen/types";
import type { AuctionVillageGroup } from "@/lib/hyphen/group";
import AuctionItemCard from "./AuctionItemCard";

type SortKey = "daysLeft" | "discount" | "gam" | "new";

interface Props {
  group: AuctionVillageGroup;
  onClose: () => void;
  onItemClick: (item: AuctionListItem) => void;
}

export default function AuctionVillageModal({ group, onClose, onItemClick }: Props) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("daysLeft");

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
      arr = arr.filter(
        (it) =>
          it.사건명칭.toLowerCase().includes(q) ||
          (it.용도 ?? "").toLowerCase().includes(q) ||
          it.대표소재지.toLowerCase().includes(q),
      );
    }
    return [...arr].sort((a, b) => {
      if (sortKey === "daysLeft") {
        // 임박 우선 (양수 D-day 작은 순). 마감(-)은 뒤로.
        const aLive = a.daysLeft >= 0;
        const bLive = b.daysLeft >= 0;
        if (aLive !== bLive) return aLive ? -1 : 1;
        return a.daysLeft - b.daysLeft;
      }
      if (sortKey === "discount") return b.discountRatio - a.discountRatio;
      if (sortKey === "gam") return b.감정가 - a.감정가;
      // new — 신건 우선, 그 안에선 D-day 임박 순
      const aNew = a.진행상태 === "신건" ? 1 : 0;
      const bNew = b.진행상태 === "신건" ? 1 : 0;
      if (aNew !== bNew) return bNew - aNew;
      return a.daysLeft - b.daysLeft;
    });
  }, [group.items, search, sortKey]);

  // 위치 표기 — 동 이름 + 첫 매물 대표소재지 앞부분 (시도/시군구 추출)
  const headerAddr = useMemo(() => {
    const first = group.items[0];
    if (!first) return group.emdName;
    // 대표소재지 앞 토큰 2~3개 (시도+시군구) + emdName
    const tokens = first.대표소재지.split(/\s+/).slice(0, 2).join(" ");
    return [tokens, group.emdName].filter(Boolean).join(" ");
  }, [group]);

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 md:p-4">
      <div className="bg-white rounded-t-xl md:rounded-xl shadow-2xl w-full md:max-w-3xl h-[80dvh] md:h-auto md:max-h-[90vh] flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">
        {/* 헤더 — amber 톤 */}
        <div className="px-3 py-2 md:px-5 md:py-4 border-b space-y-1.5 bg-amber-50">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-500 mb-0.5">경매 매물</div>
              <div className="text-sm md:text-base font-bold text-gray-900 truncate">
                {headerAddr}
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                {filtered.length.toLocaleString()}건
                {search && (
                  <span className="ml-1 text-gray-400">
                    (전체 {group.items.length.toLocaleString()}건)
                  </span>
                )}
                {group.avgDiscountRatio > 0 && (
                  <span className="ml-2 text-rose-600 font-bold tabular-nums">
                    평균 -{Math.round(group.avgDiscountRatio * 100)}%
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
          {/* 검색 + 정렬 */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="사건번호, 용도, 소재지 검색..."
              className="flex-1 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 border border-gray-300 rounded-md bg-white focus:outline-none focus:border-amber-500"
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="px-2 py-2 text-xs text-gray-700 border border-gray-300 rounded-md bg-white focus:outline-none focus:border-amber-500"
            >
              <option value="daysLeft">임박순</option>
              <option value="discount">할인율순</option>
              <option value="gam">감정가순</option>
              <option value="new">신건 우선</option>
            </select>
          </div>
        </div>

        {/* 본문 — 매물 카드 리스트 */}
        <div className="overflow-auto flex-1 min-h-0 p-3 md:p-4 space-y-2.5">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">결과 없음</div>
          ) : (
            filtered.map((it) => (
              <AuctionItemCard
                key={it.경매번호}
                item={it}
                onClick={() => onItemClick(it)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
