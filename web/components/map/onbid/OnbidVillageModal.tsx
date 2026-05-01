"use client";

/**
 * 공매 마을 매물 리스트 모달 — OnbidVillageCard 의 [매물 N건 보기] 클릭 시 표시.
 *
 * 전기 LocationDetailModal 와 시각/레이아웃 일관성:
 *   - 같은 fixed inset-0 z-50 wrapper, 같은 ESC 닫기, 같은 모바일 바텀시트
 *   - 같은 헤더 (주소 + 닫기) + 같은 검색/정렬 행 위치
 * 차이:
 *   - 본문: 표 → 카드 리스트 (매물은 컬럼 정렬보다 카드가 자연스러움)
 *   - 색상: blue → rose
 *   - 검색 필드: "번지/변전소" → "매물명"
 *   - 정렬: 번지/용량 → D-day/감정가/할인율
 */

import { useEffect, useMemo, useState } from "react";
import type { OnbidListItem } from "@/lib/onbid/types";
import { OUR_CATEGORY_LABEL } from "@/lib/onbid/types";
import type { OnbidVillageGroup } from "@/lib/onbid/group";
import { jibunFromPnu } from "@/lib/geo/pnu";

type SortKey = "apslEvlAmt" | "usbdNft" | "name";

interface Props {
  group: OnbidVillageGroup;
  onClose: () => void;
  onItemClick: (item: OnbidListItem) => void;
}

export default function OnbidVillageModal({ group, onClose, onItemClick }: Props) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("apslEvlAmt");

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
          it.onbidCltrNm.toLowerCase().includes(q) ||
          it.cltrUsgSclsCtgrNm.toLowerCase().includes(q) ||
          it.cltrMngNo.includes(q),
      );
    }
    return [...arr].sort((a, b) => {
      if (sortKey === "apslEvlAmt") return b.apslEvlAmt - a.apslEvlAmt;
      if (sortKey === "usbdNft") return (b.usbdNft ?? 0) - (a.usbdNft ?? 0);
      // name
      return a.onbidCltrNm.localeCompare(b.onbidCltrNm, "ko");
    });
  }, [group.items, search, sortKey]);

  const locationName = [group.sd, group.sgg, group.emd].filter(Boolean).join(" ");

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 md:p-4">
      <div className="bg-white rounded-t-xl md:rounded-xl shadow-2xl w-full md:max-w-3xl h-[80dvh] md:h-auto md:max-h-[90vh] flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">
        {/* 헤더 — LocationDetailModal 와 동일 레이아웃 */}
        <div className="px-3 py-2 md:px-5 md:py-4 border-b space-y-1.5 bg-rose-50">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-500 mb-0.5">공매 매물</div>
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
          {/* 검색 + 정렬 — LocationDetailModal table 모드와 동일 위치 */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="매물명, 카테고리, 관리번호 검색..."
              className="flex-1 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 border border-gray-300 rounded-md bg-white focus:outline-none focus:border-rose-500"
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="px-2 py-2 text-xs text-gray-700 border border-gray-300 rounded-md bg-white focus:outline-none focus:border-rose-500"
            >
              <option value="apslEvlAmt">감정가순</option>
              <option value="usbdNft">유찰순</option>
              <option value="name">이름순</option>
            </select>
          </div>
        </div>

        {/* 본문 — 매물 카드 리스트 */}
        <div className="overflow-auto flex-1 min-h-0 p-3 md:p-4 space-y-2.5">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">결과 없음</div>
          ) : (
            filtered.map((it) => (
              <ItemCard key={it.cltrMngNo} item={it} onClick={() => onItemClick(it)} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────
// 매물 카드 1건
// ───────────────────────────────────────────

function ItemCard({
  item,
  onClick,
}: {
  item: OnbidListItem;
  onClick: () => void;
}) {
  // 목록 카드 — 캠코 응답 단일 row 의 정확한 정보만 표시.
  // 회차 추정/할인율/"최저입찰가" 는 어느 회차 row 인지 알 수 없어 거짓 위험 → 표시 X.
  // 회차/현재가/할인율은 매물 클릭 시 상세 팝업(OnbidTab)에서 동단위 호출로 정확히 분석.
  const jibun = jibunFromPnu(item.ltnoPnu) ?? "—";

  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-left bg-white border border-gray-200 hover:border-rose-300 hover:bg-rose-50/30 rounded-lg transition-colors"
    >
      <div className="flex items-stretch">
        {/* 좌측 — 지번 컬럼 */}
        <div className="flex-shrink-0 w-20 md:w-24 flex flex-col items-center justify-center px-2 py-3 border-r border-gray-100 bg-gray-50/60 rounded-l-lg">
          <span className="text-[10px] text-gray-400 mb-0.5">지번</span>
          <span className="inline-flex items-center gap-1 text-rose-600 font-semibold text-sm">
            <span className="text-[10px]">📍</span>
            <span className="tabular-nums">{jibun}</span>
          </span>
        </div>

        {/* 우측 — 매물 상세 */}
        <div className="flex-1 min-w-0 p-3">
          {/* 1줄: 카테고리 배지 + 재산유형 + 유찰 */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            {item.ourCategory && (
              <span className="text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded">
                {OUR_CATEGORY_LABEL[item.ourCategory]}
              </span>
            )}
            <span className="text-[11px] text-gray-500">{item.cltrUsgSclsCtgrNm}</span>
            <span className="text-[11px] text-gray-300">·</span>
            <span className="text-[11px] text-gray-500">{item.prptDivNm}</span>
            {item.usbdNft != null && item.usbdNft > 0 && (
              <span className="ml-auto text-[11px] text-amber-700 font-semibold">
                유찰 {item.usbdNft}회
              </span>
            )}
          </div>

          {/* 2줄: 매물명 */}
          <div className="text-sm text-gray-900 mb-1.5 font-semibold leading-tight truncate">
            {item.onbidCltrNm}
          </div>

          {/* 3줄: 감정가 */}
          <div className="flex items-baseline gap-1.5 mb-1">
            <span className="text-[11px] text-gray-500">감정가</span>
            <span className="text-base font-bold text-gray-900 tabular-nums leading-none">
              {formatPrice(item.apslEvlAmt)}
            </span>
          </div>

          {/* 4줄: 면적 */}
          {(item.landSqms != null || (item.bldSqms != null && item.bldSqms > 0)) && (
            <div className="text-[11px] text-gray-600">
              {item.landSqms != null && item.landSqms > 0 && (
                <span>토지 {item.landSqms.toLocaleString()}㎡</span>
              )}
              {item.landSqms != null && item.bldSqms != null && item.bldSqms > 0 && (
                <span className="text-gray-300"> · </span>
              )}
              {item.bldSqms != null && item.bldSqms > 0 && (
                <span>건물 {item.bldSqms.toLocaleString()}㎡</span>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function formatPrice(won: number): string {
  if (won >= 100_000_000) {
    const eok = won / 100_000_000;
    return eok >= 10 ? `${Math.round(eok).toLocaleString()}억` : `${eok.toFixed(1)}억`;
  }
  if (won >= 10_000) return `${Math.round(won / 10_000).toLocaleString()}만`;
  return `${won.toLocaleString()}원`;
}
