"use client";

/**
 * 시설 모드 검색 패널 — Sidebar 안에 inline 으로 들어감.
 *
 * UqVillageSearchPanel 패턴 미러. 차이점:
 *   - 읍·면·동 dropdown 추가 (필수, /api/regions/eupmyeondong)
 *   - 시설 카테고리 다중 체크박스 (10종, 클라이언트 후처리 필터)
 *   - 최소 평수 슬라이더 (archArea 기반 클라이언트 후처리)
 *
 * 데이터 흐름:
 *   1. /api/regions/sigungu → 시도/시군구 (atomic, 30일 CDN)
 *   2. 시군구 선택 → /api/regions/eupmyeondong (시군구별 lazy)
 *   3. [검색] → fetchAllBuildingsByBjd (자동 페이지 순회 max 20 = 2,000건)
 *   4. filterAndClassifyBuildings (카테고리 + 평수 클라이언트 필터)
 *   5. 결과 카드 + 부모(MapClient) 로 forward → 마커
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadModeState,
  saveModeState,
  clearModeState,
} from "@/lib/modes/storage";
import {
  FACILITY_EMPTY_PARAMS,
  canFacilitySearch,
  type FacilityPersistedState,
  type FacilitySearchParams,
  type FacilitySearchResult,
} from "@/lib/modes/modes/facility";
import {
  fetchSigungus,
  fetchEupmyeondongs,
  type SigunguEntry,
  type EupmyeondongEntry,
} from "@/lib/api/regions";
import { fetchFacilitySearch } from "@/lib/api/buildings";
import type { FacilityListItem } from "@/lib/facility/enrich";
import {
  FACILITY_CATEGORIES,
  FACILITY_CATEGORY_ORDER,
  filterClassifiedItems,
  type FacilityCategory,
} from "@/lib/facility/classify";

const MODE_ID = "facility";

/** 평수 슬라이더 기준점 — UI는 이 중에서 선택 */
const PYEONG_STEPS = [0, 30, 50, 100, 150, 200, 300, 500, 1000];

interface Props {
  /** 검색 결과 변경 — 부모(MapClient) 가 마커 표시용으로 보유 */
  onResults?: (results: FacilitySearchResult[]) => void;
  /** 결과 카드 클릭 — 부모가 지도 카메라 이동 + 강조 */
  onItemClick?: (result: FacilitySearchResult) => void;
}

export default function FacilitySearchPanel({ onResults, onItemClick }: Props) {
  const persisted =
    typeof window !== "undefined"
      ? loadModeState<FacilityPersistedState>(MODE_ID)
      : null;

  const [params, setParams] = useState<FacilitySearchParams>(
    persisted?.params ?? FACILITY_EMPTY_PARAMS,
  );
  /**
   * 검색으로 받은 결과 (분류·좌표 박힌 FacilityListItem[]).
   * 카테고리/평수 변경 시 이걸 클라이언트 메모리에서 즉시 재필터 — 추가 API 호출 0.
   */
  const [rawItems, setRawItems] = useState<FacilityListItem[]>(
    persisted?.rawItems ?? [],
  );
  const [totalCount, setTotalCount] = useState<number>(persisted?.totalCount ?? 0);
  const [capped, setCapped] = useState<boolean>(persisted?.capped ?? false);
  const [hasSearched, setHasSearched] = useState(
    (persisted?.rawItems?.length ?? 0) > 0,
  );
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  /**
   * 검색조건 영역 접기/펼치기 — 모바일 세로 공간 확보용.
   * 검색 후엔 자동으로 접고 (결과 보기), 다시 검색하려면 사용자가 펼침.
   */
  const [panelCollapsed, setPanelCollapsed] = useState<boolean>(false);

  /**
   * 표시 결과 — rawItems + 카테고리/평수 필터 클라이언트 적용.
   * params.categories / params.minPyeong 또는 rawItems 가 변하면 즉시 재계산.
   */
  const results = useMemo<FacilitySearchResult[]>(
    () =>
      filterClassifiedItems(rawItems, {
        categories: new Set(params.categories),
        minPyeong: params.minPyeong,
      }),
    [rawItems, params.categories, params.minPyeong],
  );

  /** 결과 변경 시 부모로 forward (마커 그릴 때 같이 갱신) */
  const onResultsRef = useRef(onResults);
  onResultsRef.current = onResults;
  useEffect(() => {
    onResultsRef.current?.(results);
  }, [results]);

  /** 시군구 마스터 — 마운트 시 1회 lazy fetch */
  const [allSigungus, setAllSigungus] = useState<SigunguEntry[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetchSigungus()
      .then((items) => {
        if (alive) setAllSigungus(items);
      })
      .catch((e) => {
        console.error("[FacilitySearchPanel] 시군구 로드 실패", e);
      })
      .finally(() => {
        if (alive) setRegionsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** 읍·면·동 마스터 — 시군구 변경 시 lazy fetch */
  const [eupms, setEupms] = useState<EupmyeondongEntry[]>([]);
  const [eupmsLoading, setEupmsLoading] = useState(false);
  useEffect(() => {
    if (!params.sigunguCode) {
      setEupms([]);
      return;
    }
    let alive = true;
    setEupmsLoading(true);
    fetchEupmyeondongs(params.sigunguCode)
      .then((items) => {
        if (alive) setEupms(items);
      })
      .catch((e) => {
        console.error("[FacilitySearchPanel] 읍·면·동 로드 실패", e);
      })
      .finally(() => {
        if (alive) setEupmsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [params.sigunguCode]);

  /** 시도 17개 */
  const sidos = useMemo(() => {
    const set = new Set<string>();
    for (const r of allSigungus) set.add(r.sido);
    return [...set];
  }, [allSigungus]);

  /** 선택 시도의 시군구 */
  const sigungus = useMemo(() => {
    if (!params.sido) return [] as Array<{ label: string; code: string }>;
    return allSigungus
      .filter((r) => r.sido === params.sido && r.label !== "")
      .map((r) => ({ label: r.label, code: r.code }));
  }, [allSigungus, params.sido]);

  /** 시도 변경 시 — 무효 시군구 자동 초기화 (sigungus 비어있는 동안은 보류) */
  useEffect(() => {
    if (!params.sigungu) return;
    if (sigungus.length === 0) return;
    const stillValid = sigungus.some((s) => s.label === params.sigungu);
    if (!stillValid) {
      setParams((p) => ({
        ...p,
        sigungu: "",
        sigunguCode: "",
        eupmyeondong: "",
        eupmyeondongCode: "",
        hasRi: false,
        riCode: "",
        riLabel: "",
      }));
    }
  }, [sigungus, params.sigungu]);

  /** 시군구 변경 시 — 무효 읍·면·동 자동 초기화 */
  useEffect(() => {
    if (!params.eupmyeondongCode) return;
    if (eupms.length === 0) return;
    const stillValid = eupms.some((e) => e.code === params.eupmyeondongCode);
    if (!stillValid) {
      setParams((p) => ({
        ...p,
        eupmyeondong: "",
        eupmyeondongCode: "",
        hasRi: false,
        riCode: "",
        riLabel: "",
      }));
    }
  }, [eupms, params.eupmyeondongCode]);

  /** 현재 선택된 읍·면·동 객체 (리 dropdown 노출 판별 + children 출처) */
  const selectedEupm = useMemo(
    () => eupms.find((e) => e.code === params.eupmyeondongCode) ?? null,
    [eupms, params.eupmyeondongCode],
  );

  const canSearch = canFacilitySearch(params) && !searching;

  /**
   * 검색 — atomic endpoint (/api/facility/search) 한 번 호출.
   *
   * 3 가지 케이스 모두 BJD 코드 N개를 조립해서 한 번에 보냄:
   *   1. 도시 (hasRi=false)         → [eupmyeondongCode]
   *   2. 농촌 + 특정 리 (riCode 10자리) → [riCode]
   *   3. 농촌 + 전체 (riCode="ALL")  → 해당 면의 모든 리 코드
   *
   * 카테고리/평수 필터는 클라이언트 useMemo 가 즉시 처리 — 서버는 분류·좌표만 박아 응답.
   */
  const runSearch = async () => {
    if (!canSearch) return;
    setSearching(true);
    setSearchError(null);
    setHasSearched(true);
    try {
      let bjdCodes: string[];
      if (params.hasRi && params.riCode === "ALL") {
        bjdCodes = (selectedEupm?.children ?? []).map((c) => c.code);
        if (bjdCodes.length === 0)
          throw new Error("이 면 아래 리 정보가 없습니다.");
      } else {
        bjdCodes = [params.hasRi ? params.riCode : params.eupmyeondongCode];
      }

      const r = await fetchFacilitySearch(bjdCodes);

      setRawItems(r.items);
      setTotalCount(r.totalCount);
      setCapped(r.capped);
      saveModeState<FacilityPersistedState>(MODE_ID, {
        params,
        rawItems: r.items,
        totalCount: r.totalCount,
        capped: r.capped,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSearchError(msg);
      setRawItems([]);
    } finally {
      setSearching(false);
    }
  };

  const reset = () => {
    setParams(FACILITY_EMPTY_PARAMS);
    setRawItems([]);
    setTotalCount(0);
    setCapped(false);
    setSearchError(null);
    setHasSearched(false);
    setPanelCollapsed(false);
    clearModeState(MODE_ID);
  };

  const toggleCategory = (cat: FacilityCategory) => {
    setParams((p) => {
      const set = new Set(p.categories);
      if (set.has(cat)) set.delete(cat);
      else set.add(cat);
      return { ...p, categories: [...set] };
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* 검색 입력 영역 — panelCollapsed=false 일 때만 렌더 */}
      {!panelCollapsed && (
      <div className="p-3 space-y-3 overflow-y-auto flex-shrink-0 border-b border-gray-100">
        {/* 지역 */}
        <Section title="지역">
          <div className="space-y-1.5">
            <Field label="시도">
              <select
                value={params.sido}
                disabled={regionsLoading}
                onChange={(e) =>
                  setParams((p) => ({
                    ...p,
                    sido: e.target.value,
                    sigungu: "",
                    sigunguCode: "",
                    eupmyeondong: "",
                    eupmyeondongCode: "",
                    hasRi: false,
                    riCode: "",
                    riLabel: "",
                  }))
                }
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-violet-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">{regionsLoading ? "불러오는 중…" : "선택"}</option>
                {sidos.map((sd) => (
                  <option key={sd} value={sd}>{sd}</option>
                ))}
              </select>
            </Field>

            <Field label="시군구">
              <select
                value={params.sigungu}
                disabled={!params.sido || regionsLoading}
                onChange={(e) => {
                  const label = e.target.value;
                  const found = sigungus.find((s) => s.label === label);
                  setParams((p) => ({
                    ...p,
                    sigungu: label,
                    sigunguCode: found?.code ?? "",
                    eupmyeondong: "",
                    eupmyeondongCode: "",
                    hasRi: false,
                    riCode: "",
                    riLabel: "",
                  }));
                }}
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-violet-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">{params.sido ? "선택" : "(시도 먼저)"}</option>
                {sigungus.map((s) => (
                  <option key={s.code} value={s.label}>{s.label}</option>
                ))}
              </select>
            </Field>

            <Field label="읍·면·동">
              <select
                value={params.eupmyeondongCode}
                disabled={!params.sigunguCode || eupmsLoading}
                onChange={(e) => {
                  const code = e.target.value;
                  const found = eupms.find((x) => x.code === code);
                  setParams((p) => ({
                    ...p,
                    eupmyeondong: found?.label ?? "",
                    eupmyeondongCode: code,
                    hasRi: !!found?.hasChildren,
                    // 부모 변경 시 리 선택은 항상 초기화
                    riCode: "",
                    riLabel: "",
                  }));
                }}
                className="w-full text-xs px-2 py-1 border border-violet-300 rounded bg-violet-50 text-gray-900 focus:border-violet-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 disabled:border-gray-300"
              >
                <option value="">
                  {!params.sigunguCode
                    ? "(시군구 먼저)"
                    : eupmsLoading
                    ? "불러오는 중…"
                    : "선택 (필수)"}
                </option>
                {eupms.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.label}{x.hasChildren ? ` (${x.children.length}개 리)` : ""}
                  </option>
                ))}
              </select>
            </Field>

            {/* 리 dropdown — 농촌 면 선택 시에만 노출 */}
            {selectedEupm?.hasChildren && (
              <Field label="리">
                <select
                  value={params.riCode}
                  onChange={(e) => {
                    const code = e.target.value;
                    if (code === "ALL") {
                      setParams((p) => ({ ...p, riCode: "ALL", riLabel: "전체" }));
                    } else {
                      const found = selectedEupm.children.find((c) => c.code === code);
                      setParams((p) => ({
                        ...p,
                        riCode: code,
                        riLabel: found?.label ?? "",
                      }));
                    }
                  }}
                  className="w-full text-xs px-2 py-1 border border-violet-300 rounded bg-violet-50 text-gray-900 focus:border-violet-500 focus:outline-none"
                >
                  <option value="">선택 (필수)</option>
                  <option value="ALL">전체 ({selectedEupm.children.length}개 리 한꺼번에)</option>
                  {selectedEupm.children.map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        </Section>

        <p className="text-[11px] text-gray-500 leading-relaxed">
          🏭 건축물대장 기반 영업 타겟 발굴. 도시는 동, 농촌은 리 단위로 조회. "전체" 선택 시 면의 모든 리를 한 번에.
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={runSearch}
            disabled={!canSearch}
            className="flex-1 py-2 rounded-md bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
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
      )}

      {/* 검색조건 접기/펼치기 토글 — 검색 후 결과 영역 확보용 (모바일 핵심) */}
      <button
        type="button"
        onClick={() => setPanelCollapsed((v) => !v)}
        title={panelCollapsed ? "검색조건 펼치기" : "검색조건 접기"}
        className="w-full py-2.5 text-[12px] font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 border-y border-violet-200 transition-colors flex items-center justify-center gap-1.5"
      >
        {panelCollapsed ? (
          <>
            <span className="text-[13px] leading-none">▾</span>
            <span className="truncate">
              검색조건
              {hasSearched && params.eupmyeondong && (
                <span className="ml-1.5 text-violet-500 font-normal">
                  ({params.eupmyeondong}
                  {params.riLabel && ` · ${params.riLabel}`})
                </span>
              )}
            </span>
          </>
        ) : (
          <>
            <span className="text-[13px] leading-none">▴</span>
            <span>검색조건 접기</span>
          </>
        )}
      </button>

      {/* 로딩/에러/결과 헤더 */}
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
        <span className="text-xs font-bold text-gray-700">결과</span>
        <span className="text-xs text-gray-500">
          {searching ? (
            "조회중…"
          ) : rawItems.length > 0 ? (
            <>
              {results.length.toLocaleString()}건
              <span className="text-gray-400">
                {" "}/ 전체 {rawItems.length.toLocaleString()}건
              </span>
            </>
          ) : (
            "—"
          )}
        </span>
      </div>

      {capped && !searching && (
        <div className="px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-800 leading-snug">
          ⚠️ 결과가 많아 처음 2,000건만 표시. 더 좁은 동을 선택해보세요.
        </div>
      )}

      {/* 필터 — 검색 결과를 클라이언트에서 즉시 좁히는 영역 (호출 X) */}
      {hasSearched && rawItems.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-100 space-y-2 bg-violet-50/30">
          <div>
            <div className="text-[11px] font-bold text-violet-800 mb-1">시설 종류 (다중 선택)</div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
              {FACILITY_CATEGORY_ORDER.map((cat) => {
                const info = FACILITY_CATEGORIES[cat];
                const checked = params.categories.includes(cat);
                return (
                  <label
                    key={cat}
                    className={
                      "flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-[12px] transition-colors min-h-[32px] " +
                      (checked
                        ? "bg-violet-100 text-violet-800"
                        : "text-gray-600 hover:bg-violet-50")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCategory(cat)}
                      className="accent-violet-600 w-4 h-4"
                    />
                    <span>{info.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-bold text-violet-800 mb-1">
              최소 평수: {params.minPyeong === 0 ? "전체" : `${params.minPyeong}평+`}
            </div>
            <input
              type="range"
              min={0}
              max={PYEONG_STEPS.length - 1}
              step={1}
              value={PYEONG_STEPS.indexOf(params.minPyeong) >= 0 ? PYEONG_STEPS.indexOf(params.minPyeong) : 0}
              onChange={(e) => {
                const idx = Number(e.target.value);
                setParams((p) => ({ ...p, minPyeong: PYEONG_STEPS[idx] ?? 0 }));
              }}
              className="w-full accent-violet-600 h-6 cursor-pointer touch-pan-y"
              style={{ minHeight: 32 }}
            />
            <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
              {PYEONG_STEPS.map((s) => (
                <span key={s}>{s === 0 ? "전체" : s}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5">
        {searchError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
            ⚠️ {searchError}
          </p>
        )}
        {!searching && !searchError && results.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-8 leading-relaxed">
            {!hasSearched ? (
              "지역을 선택하고 [검색] 버튼을 눌러주세요."
            ) : rawItems.length === 0 ? (
              <>
                이 지역에 등록된 건축물이 없습니다.
                <br />
                다른 동/리를 시도해보세요.
              </>
            ) : (
              <>
                현재 필터에 맞는 시설이 없습니다.
                <br />
                위에서 시설 종류를 추가하거나 평수를 낮춰보세요.
              </>
            )}
          </p>
        )}
        {results.map((r, i) => (
          <FacilityResultCard
            key={`${i}-${r.building.mgmBldrgstPk ?? r.building.platPlc ?? ""}`}
            index={i + 1}
            result={r}
            onClick={onItemClick}
          />
        ))}
      </div>
    </div>
  );
}

/* ── 결과 카드 ── */

interface FacilityResultCardProps {
  index: number;
  result: FacilitySearchResult;
  onClick?: (result: FacilitySearchResult) => void;
}

function FacilityResultCard({ index, result, onClick }: FacilityResultCardProps) {
  const { building: b, category, pyeong } = result;
  const catInfo = FACILITY_CATEGORIES[category];

  // 영업 핵심 1줄 — 구조/지붕/층수
  const buildSpecParts: string[] = [];
  if (b.strctCdNm) buildSpecParts.push(b.strctCdNm);
  if (b.roofCdNm) buildSpecParts.push(`${b.roofCdNm}지붕`);
  if (b.grndFlrCnt > 0) buildSpecParts.push(`${b.grndFlrCnt}층`);

  // 사용승인일 YYYYMMDD → "YYYY.MM"
  const useAprLabel = b.useAprDay && b.useAprDay.length >= 6
    ? `${b.useAprDay.slice(0, 4)}.${b.useAprDay.slice(4, 6)}`
    : null;

  // platPlc 끝에서 지번 추출 (예: "부산광역시 남구 용당동 49번지" → "49")
  const jibun = pickJibunFromPlatPlc(b.platPlc) ?? "—";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick?.(result)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(result); } }}
      className="w-full bg-white border border-gray-200 hover:border-violet-300 hover:bg-violet-50/30 rounded-lg transition-colors cursor-pointer"
    >
      <div className="flex items-stretch gap-2 px-2.5 py-2">
        {/* 좌측 본문 */}
        <div className="flex-1 min-w-0 text-left">
          {/* 1줄: #번호 카테고리 배지 ··· 평수 */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[11px] font-semibold text-violet-700 bg-violet-50 px-2 py-0.5 rounded">
              #{index} · {catInfo.label}
            </span>
            <span className="ml-auto text-sm font-bold text-violet-900 tabular-nums">
              {pyeong != null ? `${pyeong.toLocaleString()}평` : "—"}
            </span>
          </div>

          {/* 2줄: 건물명 (있을 때만) */}
          {b.bldNm && (
            <div className="text-[12px] text-gray-900 mb-1 font-semibold leading-tight truncate">
              {b.bldNm}
            </div>
          )}

          {/* 3줄: 지번주소 (전체) */}
          {b.platPlc && (
            <div className="text-[11px] text-gray-600 truncate mb-0.5">
              {b.platPlc}
            </div>
          )}

          {/* 4줄: 도로명 (지번과 다를 때만) */}
          {b.newPlatPlc && b.newPlatPlc !== b.platPlc && (
            <div className="text-[10px] text-gray-500 truncate mb-0.5">
              🛣 {b.newPlatPlc}
            </div>
          )}

          {/* 5줄: 구조·지붕·층수 (있는 항목만) */}
          {buildSpecParts.length > 0 && (
            <div className="text-[11px] text-violet-700 truncate mb-0.5">
              🏗 {buildSpecParts.join(" · ")}
            </div>
          )}

          {/* 6줄: 용도세부 + 사용승인 */}
          <div className="flex flex-wrap items-baseline justify-between text-[10px] text-gray-500 tabular-nums gap-x-2 gap-y-0.5">
            <span className="break-keep">
              {b.mainPurpsCdNm}
              {b.etcPurps && ` · ${b.etcPurps}`}
            </span>
            {useAprLabel && <span className="flex-shrink-0">사용승인 {useAprLabel}</span>}
          </div>
        </div>

        {/* 우측 — 📍 지번 핀 (공매·경매 패턴 미러) */}
        {jibun !== "—" && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClick?.(result);
            }}
            className="flex-shrink-0 inline-flex items-center gap-0.5 self-center px-2 py-1 rounded text-violet-600 font-semibold hover:bg-violet-100 active:bg-violet-200 transition-colors text-xs"
            title="지도에서 이 지번 위치 보기"
          >
            <span className="text-[10px]">📍</span>
            <span className="tabular-nums">{jibun}</span>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * platPlc 한글 주소 끝에서 지번만 추출.
 *   "부산광역시 남구 용당동 49번지"  → "49"
 *   "전라남도 여수시 남면 연도리 산 359"  → "산359"
 *   "… 88-2번지"  → "88-2"
 */
function pickJibunFromPlatPlc(platPlc: string | null): string | null {
  if (!platPlc) return null;
  // "산 NNN[-NN]" 우선
  const sanMatch = platPlc.match(/산\s*(\d+(?:-\d+)?)/);
  if (sanMatch) return `산${sanMatch[1]}`;
  // 일반 "NNN[-NN]번지" 또는 끝 숫자
  const m = platPlc.match(/(\d+(?:-\d+)?)\s*번지?\s*$/) ?? platPlc.match(/(\d+(?:-\d+)?)\s*$/);
  return m ? m[1] : null;
}

/* ── 보조 컴포넌트 ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-gray-700 mb-1">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-gray-500 w-14 flex-shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
