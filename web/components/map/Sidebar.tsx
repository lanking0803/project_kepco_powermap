"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import LogoutButton from "@/components/auth/LogoutButton";
import FilterPanel from "./FilterPanel";
import CompareFilterPanel from "./CompareFilterPanel";
import RegionFilter, { applyRegionFilter, EMPTY_REGION, type RegionSelection } from "./RegionFilter";
import SearchResultList, { type SearchPick } from "./SearchResultList";
import type { MapSummaryRow, ColumnFilters, KepcoDataRow } from "@/lib/types";
import type { SearchRiResult } from "@/lib/search/searchKepco";
import { enrichKepcoCapaRowsWithVillageInfo } from "@/lib/api/enrich";
import UserGuide from "./UserGuide";
import OnbidSearchPanel from "./OnbidSearchPanel";
import UqVillageSearchPanel from "./UqVillageSearchPanel";
import AuctionSearchPanel from "./AuctionSearchPanel";
import type { OnbidListItem } from "@/lib/onbid/types";
import ModeSelector from "./ModeSelector";
import { getDataMode, type DataModeId } from "@/lib/modes/registry";

type SidebarTab = "search" | "filter" | "compare";

interface Props {
  isAdmin: boolean;
  email: string;
  totalRows: MapSummaryRow[];
  filters: ColumnFilters;
  onFiltersChange: (f: ColumnFilters) => void;
  isOpen: boolean;
  onToggle: () => void;
  /** 검색 결과 클릭 */
  onSearchPick?: (pick: SearchPick) => void;
  /** 지번 핀 표시 */
  onJibunPin?: (row: KepcoDataRow) => void;
  /** 검색바 포커스 시 (카드 숨기기 등) */
  onSearchFocus?: () => void;
  /** 데이터 새로고침 */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** 현재 선택된 마을 주소 (결과 하이라이트용) */
  selectedAddr?: string | null;
  /** 지도 필터 적용 (2단계 결과 진입 시) */
  onMapFilter?: (addrs: Set<string>, source: "search" | "filter" | "compare") => void;
  /** 지도 필터 해제 */
  onClearMapFilter?: () => void;
  /** 패널 리셋 키 — 값이 바뀌면 현재 패널 1단계로 복귀 */
  panelResetKey?: number;
  /** 데이터 모드 — DataModeId. 헤더 색/검색 패널/콘텐츠 분기 기준. */
  mode?: DataModeId;
  /** 모드 변경 콜백 — ModeSelector 가 호출. */
  onModeChange?: (next: DataModeId) => void;
  /** 공매 검색 결과 변경 콜백 (지도 마커용) */
  onOnbidResults?: (items: OnbidListItem[]) => void;
  /** 공매 매물 카드 클릭 콜백 */
  onOnbidItemClick?: (item: OnbidListItem) => void;
  /** 자연취락지구 — 칩(매칭 마을명) 클릭. 마을 진입 흐름. */
  onUqVillagePick?: (row: MapSummaryRow) => void;
  /** 자연취락지구 — 카드 본체 클릭. 그 폴리곤 1개만 시각 강조. */
  onUqPolygonFocus?: (village: {
    polygon: number[][][];
    center: { lat: number; lng: number };
  }) => void;
}

// ── 검색 히스토리 ──
const HISTORY_KEY = "kepco_search_history";
const HISTORY_MAX = 10;
function getHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function addHistory(q: string) {
  const list = getHistory().filter((h) => h !== q);
  list.unshift(q);
  if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}
function removeHistory(q: string) {
  const list = getHistory().filter((h) => h !== q);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

interface SearchState {
  loading: boolean;
  error: string | null;
  ri: SearchRiResult[];
  ji: KepcoDataRow[];
  // /api/search 응답의 parsed (042). 폴백 제거 — jiFallback 필드 없음.
  parsed: {
    addrNormalized: string;
    lotMain: number | null;
    lotSub: number | null;
    jibunInvalid: boolean;
  } | null;
}
const EMPTY_SEARCH: SearchState = { loading: false, error: null, ri: [], ji: [], parsed: null };

// 히스토리 1행 — 한글칸 + 지번칸 한 쌍으로 저장.
// 042 이전엔 단일 문자열 저장이었는데, 입력 분리 후엔 두 칸 복원이 필요.
interface HistoryItem {
  addr: string;
  jibun: string;
}

function getHistoryItems(): HistoryItem[] {
  const raw = getHistory();
  return raw
    .map((s) => {
      try {
        const o = JSON.parse(s);
        if (o && typeof o.addr === "string" && typeof o.jibun === "string") return o as HistoryItem;
      } catch {
        // 042 이전 저장값 (단순 문자열) — 한글칸으로 마이그레이션
      }
      return { addr: s, jibun: "" };
    });
}
function addHistoryItem(item: HistoryItem) {
  if (!item.addr.trim() && !item.jibun.trim()) return;
  addHistory(JSON.stringify(item));
}

export default function Sidebar({
  isAdmin,
  email,
  totalRows,
  filters,
  onFiltersChange,
  isOpen,
  onToggle,
  onSearchPick,
  onJibunPin,
  onSearchFocus,
  onRefresh,
  refreshing,
  selectedAddr,
  onMapFilter,
  onClearMapFilter,
  panelResetKey = 0,
  mode = "default",
  onModeChange,
  onOnbidResults,
  onOnbidItemClick,
  onUqVillagePick,
  onUqPolygonFocus,
}: Props) {
  /** 현재 모드 설정 — 색/라벨/패널 분기 기준 (단일 진실 공급원 = registry) */
  const modeCfg = getDataMode(mode);
  const onbidActive = mode === "onbid";
  const [activeTab, setActiveTab] = useState<SidebarTab>("search");

  // 탭 전환 시: 지도 필터 해제 (패널은 언마운트되므로 자동 리셋)
  const handleTabChange = (tab: SidebarTab) => {
    if (tab === activeTab) return;
    onClearMapFilter?.();
    setActiveTab(tab);
  };

  const [showGuide, setShowGuide] = useState(false);

  // 첫 방문 가이드
  useEffect(() => {
    const key = "kepco_guide_dismissed";
    if (!localStorage.getItem(key)) setShowGuide(true);
  }, []);
  const dismissGuide = () => {
    setShowGuide(false);
    localStorage.setItem("kepco_guide_dismissed", "1");
  };

  // ── 검색 상태 (042: addr/jibun 분리) ──
  const [addrInput, setAddrInput] = useState("");
  const [jibunInput, setJibunInput] = useState("");
  const [searchState, setSearchState] = useState<SearchState>(EMPTY_SEARCH);
  const [searchTab, setSearchTab] = useState<"ri" | "ji">("ri");
  const [searchRegion, setSearchRegion] = useState<RegionSelection>(EMPTY_REGION);
  const [historyOpen, setHistoryOpen] = useState(false);
  const addrInputRef = useRef<HTMLInputElement>(null);

  const doSearch = useCallback(async (addr: string, jibun: string) => {
    const a = addr.trim();
    const j = jibun.trim();
    if (!a && !j) return;

    addHistoryItem({ addr: a, jibun: j });
    setHistoryOpen(false);
    setSearchState({ ...EMPTY_SEARCH, loading: true });
    try {
      const params = new URLSearchParams();
      if (a) params.set("addr", a);
      if (j) params.set("jibun", j);
      const res = await fetch(`/api/search?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(data.error || "검색이 잘 안 돼요. 잠시 후 다시 시도해 주세요.");
      }
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "검색이 잘 안 돼요.");
      const ri = (data.ri ?? []) as SearchRiResult[];
      // ji 응답 (KepcoDataRow[]) 은 주소 필드 없음 → 클라이언트 enrichment 로 합성.
      const jiRaw = (data.ji ?? []) as KepcoDataRow[];
      const ji = enrichKepcoCapaRowsWithVillageInfo(jiRaw, totalRows);
      setSearchState({ loading: false, error: null, ri, ji, parsed: data.parsed ?? null });
      // 본번이 들어왔으면 ji 탭, 아니면 ri 탭
      setSearchTab(data.parsed?.lotMain != null ? "ji" : "ri");
      setSearchRegion(EMPTY_REGION);

      // 검색 결과 마을을 지도에 표시
      const addrs = new Set<string>();
      ri.forEach((r) => r.geocode_address && addrs.add(r.geocode_address));
      ji.forEach((r) => r.geocode_address && addrs.add(r.geocode_address));
      if (addrs.size > 0) onMapFilter?.(addrs, "search");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSearchState({ ...EMPTY_SEARCH, error: msg });
    }
  }, [onMapFilter, totalRows]);

  const handleClear = () => {
    setAddrInput("");
    setJibunInput("");
    setSearchState(EMPTY_SEARCH);
    setSearchRegion(EMPTY_REGION);
    onClearMapFilter?.();
  };

  // "여유 있는 곳만 보기" 빠른 토글
  const isPromisingMode =
    filters.cap_subst.size === 1 &&
    filters.cap_subst.has("전부 여유") &&
    filters.cap_mtr.size === 1 &&
    filters.cap_mtr.has("전부 여유") &&
    filters.cap_dl.size === 1 &&
    filters.cap_dl.has("전부 여유");

  const togglePromising = () => {
    if (isPromisingMode) {
      onFiltersChange({
        ...filters,
        cap_subst: new Set(),
        cap_mtr: new Set(),
        cap_dl: new Set(),
      });
    } else {
      // 활성: 3시설 모두 "전부 여유"로
      onFiltersChange({
        ...filters,
        cap_subst: new Set(["전부 여유"]),
        cap_mtr: new Set(["전부 여유"]),
        cap_dl: new Set(["전부 여유"]),
      });
    }
  };

  return (
    <>
      {/* 모바일 오버레이 백드롭 */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={onToggle}
        />
      )}

      {/* ── 사이드바 + 엣지 핸들 래퍼 ── */}
      <div
        className={`
          flex flex-shrink-0
          fixed inset-y-0 left-0 z-50
          md:relative md:z-10 md:inset-auto
          transition-all duration-300 ease-in-out
          ${isOpen ? "translate-x-0 md:ml-0" : "-translate-x-full md:-ml-80"}
          md:translate-x-0
        `}
      >
      <aside
        className="w-80 max-w-[85vw] bg-white
          flex flex-col h-full"
      >
        {/* ── 헤더 ── 헤더 배경색은 현재 모드의 색 토큰을 그대로 사용 */}
        <div
          className={`px-3 py-2 border-b space-y-1.5 transition-colors ${modeCfg.colors.bgClass} ${modeCfg.colors.borderClass}`}
        >
          {/* 줄 1: 서비스명 + 모드 드롭다운 */}
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold text-gray-900 flex-1 min-w-0 truncate">
              배전선로 여유용량 지도
            </h1>
            {onModeChange && (
              <div className="shrink-0 w-24">
                <ModeSelector mode={mode} onChange={onModeChange} />
              </div>
            )}
          </div>
          {/* 줄 2: 사용 안내 + 새로고침 */}
          <div className="flex items-center gap-1.5">
            <UserGuide />
            {onRefresh && (
              <button
                onClick={() => {
                  const ok = window.confirm(
                    "지도를 최신 데이터로 갱신합니다.\n\n" +
                    "• 평소엔 자동 갱신되므로 굳이 누를 필요 없음\n" +
                    "• 방금 수집한 데이터를 즉시 반영할 때만 사용\n" +
                    "• 10~30초 걸릴 수 있음\n\n" +
                    "계속할까요?"
                  );
                  if (ok) onRefresh();
                }}
                disabled={refreshing}
                className="flex items-center gap-1 px-2 py-1 rounded-md border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-500 hover:text-gray-700 disabled:opacity-50 text-[11px] font-medium transition-colors"
                title="최신 데이터 새로고침"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  className={refreshing ? "animate-spin" : ""}
                >
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                </svg>
                {refreshing ? "갱신 중" : "새로고침"}
              </button>
            )}
          </div>
          {/* 줄 3: 사용자 정보 + 관리자 메뉴 */}
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="text-gray-400 truncate">{email}</span>
            {isAdmin && (
              <>
                <span className="font-semibold text-blue-600 bg-blue-50 px-1 py-0.5 rounded flex-shrink-0">관리자</span>
                <div className="flex gap-1.5 ml-auto flex-shrink-0">
                  <Link href="/admin/crawl" className="px-[17px] py-1 text-[11px] rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 active:bg-emerald-200 font-semibold border border-emerald-200 transition-colors">수집</Link>
                  <Link href="/admin/users" className="px-[17px] py-1 text-[11px] rounded-md bg-gray-50 text-gray-600 hover:bg-gray-100 active:bg-gray-200 font-semibold border border-gray-200 transition-colors">계정</Link>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── 모드별 검색 패널 분기 ──
            전기(default) 외 모드는 자기 패널을 풀스크린으로 표시.
            모드 추가 시 if 1줄 추가로 확장. */}
        {mode === "onbid" ? (
          <div className="flex-1 min-h-0">
            <OnbidSearchPanel
              onResults={onOnbidResults}
              onItemClick={onOnbidItemClick}
            />
          </div>
        ) : mode === "uq" ? (
          <div className="flex-1 min-h-0">
            <UqVillageSearchPanel
              totalRows={totalRows}
              onItemClick={onUqVillagePick}
              onPolygonFocus={onUqPolygonFocus}
            />
          </div>
        ) : mode === "auction" ? (
          <div className="flex-1 min-h-0">
            <AuctionSearchPanel />
          </div>
        ) : (
        <>
        {/* ── 탭: 검색 / 필터 (전기 모드만) ── */}
        <div className="flex border-b border-gray-200">
          <button
            type="button"
            onClick={() => handleTabChange("search")}
            className={`flex-1 py-2 text-xs font-semibold text-center transition-colors ${
              activeTab === "search"
                ? "text-blue-600 border-b-2 border-blue-500 bg-blue-50/30"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            🔍 주소검색
          </button>
          <button
            type="button"
            onClick={() => handleTabChange("filter")}
            className={`flex-1 py-2 text-xs font-semibold text-center transition-colors ${
              activeTab === "filter"
                ? "text-blue-600 border-b-2 border-blue-500 bg-blue-50/30"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            📋 마을검색
          </button>
          <button
            type="button"
            onClick={() => handleTabChange("compare")}
            className={`flex-1 py-2 text-xs font-semibold text-center transition-colors ${
              activeTab === "compare"
                ? "text-orange-600 border-b-2 border-orange-500 bg-orange-50/30"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            📊 변화추적
          </button>
        </div>

        {/* ── 탭 콘텐츠 ── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {activeTab === "search" && (
            <div className="flex flex-col h-full">
              {/* 검색 입력 (042: 한글 + 지번 분리) */}
              <div className="px-3 py-2.5 border-b border-gray-100 relative">
                <div className="flex items-center gap-2">
                  {/* 한글 주소칸 */}
                  <div className="flex-1 min-w-0 flex items-center gap-1.5 bg-gray-50 border border-gray-200 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-100 rounded-lg px-3 py-2">
                    <span className="text-sm text-gray-400 flex-shrink-0">🔍</span>
                    <input
                      ref={addrInputRef}
                      type="text"
                      value={addrInput}
                      onChange={(e) => {
                        setAddrInput(e.target.value);
                        setHistoryOpen(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setHistoryOpen(false);
                          doSearch(addrInput, jibunInput);
                        }
                      }}
                      onClick={() => { if (!addrInput.trim() && !jibunInput.trim()) setHistoryOpen(true); }}
                      onBlur={() => setTimeout(() => setHistoryOpen(false), 150)}
                      placeholder="시·도 시·군 동·리"
                      className="flex-1 min-w-0 text-sm text-gray-900 placeholder:text-gray-400 bg-transparent outline-none"
                    />
                    {(addrInput || jibunInput) && (
                      <button type="button" onClick={handleClear} className="p-1 text-gray-400 hover:text-gray-600 active:text-gray-800 flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd"/>
                        </svg>
                      </button>
                    )}
                  </div>
                  {/* 지번칸 — 본번-부번. 정규식 검증은 서버에서 (jibunInvalid) */}
                  <input
                    type="text"
                    value={jibunInput}
                    onChange={(e) => setJibunInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setHistoryOpen(false);
                        doSearch(addrInput, jibunInput);
                      }
                    }}
                    placeholder="29-4"
                    inputMode="text"
                    className="w-20 text-sm text-gray-900 placeholder:text-gray-400 bg-gray-50 border border-gray-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-100 rounded-lg px-2 py-2 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => doSearch(addrInput, jibunInput)}
                    disabled={(!addrInput.trim() && !jibunInput.trim()) || searchState.loading}
                    className="text-xs px-3 py-2.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed font-medium flex-shrink-0"
                  >
                    검색
                  </button>
                </div>

                {/* 히스토리 드롭다운 (한 쌍 = addr|jibun) */}
                {(() => {
                  if (!historyOpen) return null;
                  const all = getHistoryItems();
                  const q = (addrInput + " " + jibunInput).trim();
                  const filtered = q
                    ? all.filter((h) => (h.addr + " " + h.jibun).includes(q))
                    : all;
                  if (filtered.length === 0) return null;
                  return (
                    <div className="absolute left-3 right-3 top-full mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-20">
                      <div className="px-3 py-1 text-[10px] text-gray-400 font-semibold border-b border-gray-100">최근 검색</div>
                      {filtered.map((h, i) => {
                        const key = JSON.stringify(h) + "@" + i;
                        const display = [h.addr, h.jibun].filter(Boolean).join(" · ");
                        return (
                          <div key={key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 cursor-pointer group">
                            <span className="text-gray-300 text-[10px]">🕐</span>
                            <button
                              type="button"
                              className="flex-1 text-left text-xs text-gray-700 truncate"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setAddrInput(h.addr);
                                setJibunInput(h.jibun);
                                doSearch(h.addr, h.jibun);
                              }}
                            >{display}</button>
                            <button
                              type="button"
                              className="text-gray-400 hover:text-red-400 active:text-red-500 text-xs p-1 -m-1"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                removeHistory(JSON.stringify(h));
                                // 리렌더 트리거 — historyOpen 을 잠시 false 후 즉시 true
                                setHistoryOpen(false);
                                setTimeout(() => setHistoryOpen(true), 0);
                              }}
                            >✕</button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* 검색 결과 */}
              <div className="flex-1 overflow-y-auto min-h-0">
                {searchState.loading && (
                  <div className="px-4 py-8 text-center text-xs text-gray-500">검색 중...</div>
                )}
                {searchState.error && (
                  <div className="px-4 py-8 text-center">
                    <div className="text-2xl mb-1">⚠️</div>
                    <div className="text-xs text-red-700">{searchState.error}</div>
                  </div>
                )}
                {!searchState.loading && !searchState.error && (searchState.ri.length > 0 || searchState.ji.length > 0) && (
                  <>
                    {/* 지역 필터 */}
                    <div className="border-b border-gray-100">
                      <RegionFilter rows={searchState.ri} value={searchRegion} onChange={setSearchRegion} />
                    </div>
                    {/* 리/지번 탭 */}
                    {(() => {
                      const filteredRi = applyRegionFilter(searchState.ri, searchRegion);
                      const filteredJi = applyRegionFilter(searchState.ji, searchRegion);
                      return (
                        <>
                          <div className="flex border-b border-gray-100 px-2">
                            {(["ri", "ji"] as const).map((t) => {
                              const count = t === "ri" ? filteredRi.length : filteredJi.length;
                              const label = t === "ri" ? "리 단위" : "지번 단위";
                              return (
                                <button
                                  key={t}
                                  type="button"
                                  onClick={() => setSearchTab(t)}
                                  className={`px-3 py-1.5 text-[11px] font-semibold border-b-2 transition-colors flex items-center gap-1 ${
                                    searchTab === t
                                      ? "border-blue-500 text-blue-600"
                                      : "border-transparent text-gray-400 hover:text-gray-600"
                                  }`}
                                >
                                  {label}
                                  <span className={`text-[10px] px-1 rounded-full ${
                                    count > 0
                                      ? searchTab === t ? "bg-blue-500 text-white" : "bg-blue-100 text-blue-700"
                                      : "bg-gray-200 text-gray-500"
                                  }`}>{count}</span>
                                </button>
                              );
                            })}
                          </div>
                          {/* 042: 폴백 제거 — 본번 매칭 0건이면 SearchResultList 의 빈 상태 안내가 그대로 노출됨 */}
                          <SearchResultList
                            mode={searchTab}
                            ri={filteredRi}
                            ji={filteredJi}
                            selectedAddr={selectedAddr}
                            onPick={(pick) => {
                              onSearchPick?.(pick);
                              if (window.innerWidth < 768) onToggle();
                            }}
                            onJibunPin={onJibunPin ? (row) => {
                              onJibunPin(row);
                              if (window.innerWidth < 768) onToggle();
                            } : undefined}
                          />
                        </>
                      );
                    })()}
                  </>
                )}
                {!searchState.loading && !searchState.error && searchState.ri.length === 0 && searchState.ji.length === 0 && (
                  <div className="px-4 py-6 space-y-4">
                    {/* 첫 방문 가이드 */}
                    {showGuide && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-3 relative">
                        <button
                          onClick={dismissGuide}
                          className="absolute top-1.5 right-2 text-blue-400 hover:text-blue-600 text-xs p-1"
                        >✕</button>
                        <div className="text-xs font-bold text-blue-800 mb-2">처음이신가요? 이렇게 시작하세요!</div>
                        <div className="text-[11px] text-blue-700 space-y-1.5">
                          <div className="flex items-start gap-1.5">
                            <span className="shrink-0">1.</span>
                            <span><b>지도에서 마을 터치</b> → 상세 정보 확인</span>
                          </div>
                          <div className="flex items-start gap-1.5">
                            <span className="shrink-0">2.</span>
                            <span><b>검색창에 주소 입력</b> → 원하는 지역 바로 이동</span>
                          </div>
                          <div className="flex items-start gap-1.5">
                            <span className="shrink-0">3.</span>
                            <span><b>마을검색 탭</b> → 여유용량 있는 마을만 찾기</span>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="text-center">
                      <div className="text-2xl mb-2">🔍</div>
                      <div className="text-xs text-gray-500">
                        주소나 지번을 입력해 검색하세요
                      </div>
                      <div className="text-[10px] text-gray-400 mt-1">
                        예: <span className="text-gray-600 font-medium">담양읍</span>,{" "}
                        <span className="text-gray-600 font-medium">용구리 100</span>
                      </div>
                    </div>

                    {/* 한전온 외부 링크 — 우리 데이터에 없는 실시간 용량 확인용 */}
                    <a
                      href="https://online.kepco.co.kr/EWM092D00"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded-lg px-3 py-2.5 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <img
                          src="https://online.kepco.co.kr/cm/images/img-navi-logo.png"
                          alt="한전온"
                          className="h-4 w-auto flex-shrink-0"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-semibold text-gray-700">
                            선로용량 확인하기
                          </div>
                          <div className="text-[10px] text-gray-500 mt-0.5">
                            한전온에서 실시간 용량 확인 (새 창)
                          </div>
                        </div>
                        <span className="text-gray-400 text-xs">↗</span>
                      </div>
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "filter" && (
            <FilterPanel
              totalRows={totalRows}
              filters={filters}
              onChange={onFiltersChange}
              isPromisingMode={isPromisingMode}
              onTogglePromising={togglePromising}
              onSearchPick={(pick) => {
                onSearchPick?.(pick);
                if (window.innerWidth < 768) onToggle();
              }}
              onJibunPin={onJibunPin ? (row) => {
                onJibunPin(row);
                if (window.innerWidth < 768) onToggle();
              } : undefined}
              selectedAddr={selectedAddr}
              onMapFilter={(addrs) => onMapFilter?.(addrs, "filter")}
              onClearMapFilter={onClearMapFilter}
              resetKey={panelResetKey}
            />
          )}

          {activeTab === "compare" && <CompareFilterPanel />}
        </div>
        </>
        )}

        {/* 푸터 — 모드 무관 공통 */}
        <div className="px-3 py-2 border-t border-gray-200">
          <LogoutButton />
        </div>
    </aside>

      {/* ── 엣지 탭 핸들: 사이드바 오른쪽에 붙은 열기/닫기 토글 ── */}
      <button
        onClick={onToggle}
        className={`absolute left-full top-1/2 -translate-y-1/2
          w-7 h-16 flex items-center justify-center
          border border-l-0 rounded-r-lg shadow-md
          transition-colors
          ${isOpen
            ? "bg-white border-gray-200 text-gray-500 hover:text-gray-800 hover:bg-gray-50"
            : "bg-blue-500 border-blue-500 text-white hover:bg-blue-600 animate-pulse-subtle"
          }`}
        aria-label={isOpen ? "사이드바 닫기" : "사이드바 열기"}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform duration-300 ${isOpen ? "" : "rotate-180"}`}
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      </div>
    </>
  );
}
