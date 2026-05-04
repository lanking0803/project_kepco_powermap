"use client";

/**
 * 경매(Hyphen) 모드 검색 패널 — Sidebar 안에 inline 으로 들어감.
 *
 * 외곽 컨테이너/헤더 색은 부모 Sidebar 가 registry.colors 로 분기 (amber 톤).
 * 본 컴포넌트는 검색 입력 + 결과 카드 영역만 담당.
 *
 * 데이터 흐름:
 *   1. /api/regions/sigungu → 시도/시군구 드롭다운 (atomic, 30일 CDN)
 *   2. 검색 → /api/auction/search → results 부모(MapClient) 로 흘림 → 지도 마커
 *   3. 결과 카드 클릭 → onItemClick → 지도 이동 + ParcelPanel 진입
 *
 * 상태 영속화:
 *   - sessionStorage (registry.sessionKey = "auction_search_state_v1")
 *   - 마운트 시 복원된 results 도 부모로 흘려줌 (모드 전환/새로고침 후 마커 자동 복원)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadModeState,
  saveModeState,
  clearModeState,
} from "@/lib/modes/storage";
import {
  AUCTION_CATEGORY_GROUPS,
  AUCTION_CATEGORY_GROUP_ORDER,
  AUCTION_EMPTY_PARAMS,
  AUCTION_GROUP_LABEL,
  AUCTION_YONGDO_LABEL,
  type AuctionCategoryGroup,
  type AuctionPersistedState,
  type AuctionSearchUiParams,
} from "@/lib/modes/modes/auction";
import {
  fetchSigungus,
  fetchEupmyeondongs,
  type SigunguEntry,
  type EupmyeondongEntry,
} from "@/lib/api/regions";
import { formatWon } from "@/lib/format/won";
import { jibunFromPnu } from "@/lib/geo/pnu";
import type { AuctionListItem } from "@/lib/hyphen/types";
import { getClientAuctionChannel } from "@/lib/modes/auction-channel";
import CourtCategorySelector from "@/components/map/auction/CourtCategorySelector";

const MODE_ID = "auction";

/**
 * 진행상태 칩 옵션 — Hyphen 응답에 등장 가능한 한글값.
 * v5 검증(2026-05-02) 실측 등장: 신건/진행/유찰/매각/취하.
 * 변경/정지는 명세상 가능하지만 미관측 — 자주 보이지 않으므로 미노출 (필요 시 응답 후 처리).
 *
 * 정렬 = 영업 시각 흐름 (입찰 가능 → 종결 순).
 */
const PROGRESS_STATUS_OPTIONS = ["신건", "진행", "유찰", "매각", "취하"];

interface Props {
  /** 검색 결과 변경 — 지도 마커 갱신용. 마운트 시 복원된 결과도 흘림. */
  onResults?: (items: AuctionListItem[]) => void;
  /** 매물 카드 클릭 — 지도 강조 + 상세 진입 (D4-2 단계에서 사용 예정) */
  onItemClick?: (item: AuctionListItem) => void;
}


export default function AuctionSearchPanel({ onResults, onItemClick }: Props) {
  // ─── 경매 채널 (court=법원경매 직접 / hyphen=백업) ─────────
  // env NEXT_PUBLIC_AUCTION_CHANNEL 으로 분기. 미설정 시 court (현 운영).
  // 카테고리 UI / 검색 호출 두 군데에서 분기됨 — 두 분기 모두 같은 채널 보고 결정.
  const channel = getClientAuctionChannel();

  // ─── 상태 복원 ─────────────────────────────────────────────
  const persisted =
    typeof window !== "undefined"
      ? loadModeState<AuctionPersistedState>(MODE_ID)
      : null;

  const [params, setParams] = useState<AuctionSearchUiParams>(
    persisted?.params ?? AUCTION_EMPTY_PARAMS,
  );
  const [results, setResults] = useState<AuctionListItem[]>(
    persisted?.results ?? [],
  );
  /**
   * 결과 표시 모드 — 지번별(기본) / 사건별.
   * 후처리만이라 API 호출 0번 추가. 사건별 모드는 같은 (boCd, saNo) row 들을
   * 한 카드로 합쳐서 일괄매각 묶음 가시화.
   */
  const [viewMode, setViewMode] = useState<"jibun" | "case">("jibun");

  // 마운트 시 — 복원된 결과를 부모(MapClient)로 올려서 지도 마커도 즉시 복원
  const onResultsRef = useRef(onResults);
  onResultsRef.current = onResults;
  useEffect(() => {
    if (persisted && persisted.results.length > 0) {
      onResultsRef.current?.(persisted.results);
    }
    // 마운트 1회만 — persisted 는 클로저 캡처라 deps 변경 X
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── 시군구 마스터 (모든 모드 공통 atomic) ──────────────────
  const [allSigungus, setAllSigungus] = useState<SigunguEntry[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetchSigungus()
      .then((items) => {
        if (alive) setAllSigungus(items);
      })
      .catch((e) => {
        console.error("[AuctionSearchPanel] 시군구 로드 실패", e);
      })
      .finally(() => {
        if (alive) setRegionsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** 읍·면·동 마스터 — 시군구 변경 시 lazy fetch.
   * FacilitySearchPanel 패턴 미러. 경매에선 읍면동이 선택사항(전체 옵션 노출). */
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
        console.error("[AuctionSearchPanel] 읍·면·동 로드 실패", e);
      })
      .finally(() => {
        if (alive) setEupmsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [params.sigunguCode]);

  /** 시도 unique 목록 */
  const sidos = useMemo(() => {
    const set = new Set<string>();
    for (const r of allSigungus) set.add(r.sido);
    return [...set];
  }, [allSigungus]);

  /** 선택 시도의 시군구 옵션 — { label 한글, code 5자리 } */
  const sigungus = useMemo(() => {
    if (!params.sido) return [] as Array<{ label: string; code: string }>;
    return allSigungus
      .filter((r) => r.sido === params.sido && r.label !== "")
      .map((r) => ({ label: r.label, code: r.code }));
  }, [allSigungus, params.sido]);

  /** 시도 변경 시 무효 시군구 자동 초기화.
   * sigungus 가 비어있는 동안은 검증 보류 (atomic 미응답 시 복원값 보존). */
  useEffect(() => {
    if (!params.sigungu) return;
    if (sigungus.length === 0) return;
    const stillValid = sigungus.some((s) => s.label === params.sigungu);
    if (!stillValid) {
      setParams((p) => ({ ...p, sigungu: "", sigunguCode: "", emdong: "" }));
    }
  }, [sigungus, params.sigungu]);

  /** 시군구 변경 또는 읍면동 데이터 로드 후 — 무효 emdong 자동 초기화.
   * 다른 시군구의 읍면동 라벨이 sessionStorage 에 남아있을 때 안 비워주면
   * 잘못된 검색 파라미터로 호출됨. eupms 비어있는 동안은 보류 (lazy fetch 진행 중). */
  useEffect(() => {
    if (!params.emdong) return;
    if (eupms.length === 0) return;
    const stillValid = eupms.some((e) => e.label === params.emdong);
    if (!stillValid) {
      setParams((p) => ({ ...p, emdong: "" }));
    }
  }, [eupms, params.emdong]);

  // ─── 영속화 ──────────────────────────────────────────────
  useEffect(() => {
    saveModeState<AuctionPersistedState>(MODE_ID, {
      params,
      results,
      totalCountAll: null,
    });
  }, [params, results]);

  // ─── 카테고리 펼치기 상태 — 한 번에 1개 그룹만 펼침 (시각 단순화) ──
  const [expandedGroup, setExpandedGroup] = useState<AuctionCategoryGroup | null>(
    null,
  );

  // ─── 고급 필터 펼침 상태 — 모바일 시각 부담 줄임. 디폴트 접힘. ──
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ─── 검색 ─────────────────────────────────────────────
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Hyphen apiStatus — 인증 실패/잔액부족/레이트리밋/일시장애 안내용.
   * 검증된 상태:
   *   - "auth_failed"           : 결제 만료 / 키 오류 (HDM006/HDM009)
   *   - "no_permission"         : 운영 모드 권한 미신청 (HDM012)
   *   - "rate_limited"          : 테스트 모드 20초 (HDM016)
   *   - "insufficient_balance"  : 비즈머니 부족 (운영 모드)
   *   - "unavailable"           : 5xx / 네트워크
   */
  const [apiStatus, setApiStatus] = useState<string | null>(null);
  const [totalCountAll, setTotalCountAll] = useState<number | null>(null);
  const [truncated, setTruncated] = useState(false);
  const canSearch = params.sigunguCode !== "" && !searching;

  /**
   * 검색창 접힘/펼침 — 사용자가 명시적으로 토글.
   * 결과 헤더 위 가로 버튼([▴ 접기] / [▾ 펼치기])으로 제어.
   * 자동 접힘 안 함 — 사용자 의도 우선.
   */
  const [panelCollapsed, setPanelCollapsed] = useState<boolean>(false);

  const runSearch = async () => {
    if (!canSearch) return;
    setSearching(true);
    setError(null);
    setApiStatus(null);
    try {
      const qs = new URLSearchParams();
      qs.set("sigunguCode", params.sigunguCode);
      if (params.sido) qs.set("sidoName", params.sido);
      if (params.emdong) qs.set("emdong", params.emdong);
      if (params.yongdoCodes.length > 0)
        qs.set("yongdoCodes", params.yongdoCodes.join(","));
      // court 채널 — 직접 court 소분류 코드 흘림 (Phase C 에서 route.ts 가 사용)
      if (params.courtSclCodes.length > 0)
        qs.set("courtSclCodes", params.courtSclCodes.join(","));
      if (params.progressStatus.length > 0)
        qs.set("progressStatus", params.progressStatus.join(","));
      if (params.landMin != null) qs.set("landMin", String(params.landMin));
      if (params.landMax != null) qs.set("landMax", String(params.landMax));
      if (params.bareaMin != null) qs.set("bareaMin", String(params.bareaMin));
      if (params.bareaMax != null) qs.set("bareaMax", String(params.bareaMax));
      if (params.gamMin != null) qs.set("gamMin", String(params.gamMin));
      if (params.gamMax != null) qs.set("gamMax", String(params.gamMax));
      if (params.lowMin != null) qs.set("lowMin", String(params.lowMin));
      if (params.lowMax != null) qs.set("lowMax", String(params.lowMax));
      if (params.bidStart) qs.set("bidStart", params.bidStart);
      if (params.bidEnd) qs.set("bidEnd", params.bidEnd);
      if (params.usbdMin != null) qs.set("usbdMin", String(params.usbdMin));
      if (params.usbdMax != null) qs.set("usbdMax", String(params.usbdMax));
      if (params.discountMin != null)
        qs.set("discountMin", String(params.discountMin));
      if (params.discountMax != null)
        qs.set("discountMax", String(params.discountMax));

      const res = await fetch(`/api/auction/search?${qs.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }

      const items: AuctionListItem[] = json.items ?? [];
      setApiStatus(json.apiStatus ?? "ok");
      setResults(items);
      setTotalCountAll(json.totalCountAll ?? null);
      setTruncated(Boolean(json.truncated));
      onResults?.(items);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setResults([]);
      onResults?.([]);
    } finally {
      setSearching(false);
    }
  };

  const reset = () => {
    setParams(AUCTION_EMPTY_PARAMS);
    setResults([]);
    setError(null);
    setApiStatus(null);
    setTotalCountAll(null);
    setTruncated(false);
    setPanelCollapsed(false); // 초기화 = 검색창 다시 펼침
    onResults?.([]);
    clearModeState(MODE_ID);
  };

  /** 진행상태 칩 토글 — 다중 선택. 빈 배열 허용(=결과 없음 방지로 검색버튼은 활성 유지). */
  const toggleProgressStatus = (status: string) => {
    setParams((p) => ({
      ...p,
      progressStatus: p.progressStatus.includes(status)
        ? p.progressStatus.filter((s) => s !== status)
        : [...p.progressStatus, status],
    }));
  };

  /** 그룹 칩 토글 — 그룹 멤버 모두 OFF→ON / 일부라도 ON→모두 OFF (3상 토글). */
  const toggleGroup = (group: AuctionCategoryGroup) => {
    const groupCodes = AUCTION_CATEGORY_GROUPS[group];
    setParams((p) => {
      const allOn = groupCodes.every((c) => p.yongdoCodes.includes(c));
      const next = allOn
        ? p.yongdoCodes.filter((c) => !groupCodes.includes(c)) // 다 켜짐 → 다 끔
        : [
            ...p.yongdoCodes.filter((c) => !groupCodes.includes(c)),
            ...groupCodes,
          ]; // 일부/전무 → 전부 켬
      return { ...p, yongdoCodes: next };
    });
  };

  /** 개별 yongdo 코드 토글 — 그룹 펼침 안에서 사용. */
  const toggleYongdo = (code: string) => {
    setParams((p) => ({
      ...p,
      yongdoCodes: p.yongdoCodes.includes(code)
        ? p.yongdoCodes.filter((c) => c !== code)
        : [...p.yongdoCodes, code],
    }));
  };

  // ─── 렌더 ────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* 검색 입력 — panelCollapsed=false 일 때만 렌더 */}
      {!panelCollapsed && (
      <div className="p-3 space-y-3 overflow-y-auto flex-shrink-0 border-b border-gray-100">
        {/* 지역 */}
        <Section title="지역">
          <div className="space-y-1.5">
            <Field label="시도">
              <select
                value={params.sido}
                disabled={regionsLoading}
                onChange={(e) => {
                  const newSido = e.target.value;
                  // 세종특별자치시는 산하 시군구 없음 — 시도 자체를 시군구로 자동 세팅.
                  // bjd_master 시도 row 의 bjd_code 첫 5자리가 그대로 sigunguCode 로 동작.
                  const isSejong = newSido === "세종특별자치시";
                  const sejongRow = isSejong
                    ? allSigungus.find((s) => s.sido === newSido)
                    : null;
                  setParams((p) => ({
                    ...p,
                    sido: newSido,
                    sigungu: isSejong ? newSido : "",
                    sigunguCode: sejongRow?.code ?? "",
                    emdong: "",
                  }));
                }}
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-amber-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">
                  {regionsLoading ? "불러오는 중…" : "전체"}
                </option>
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
                disabled={
                  !params.sido ||
                  regionsLoading ||
                  params.sido === "세종특별자치시"
                }
                onChange={(e) => {
                  const label = e.target.value;
                  const found = sigungus.find((s) => s.label === label);
                  setParams((p) => ({
                    ...p,
                    sigungu: label,
                    sigunguCode: found?.code ?? "",
                    emdong: "",
                  }));
                }}
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-amber-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">
                  {params.sido === "세종특별자치시"
                    ? "세종특별자치시 (시군구 없음)"
                    : params.sido
                      ? "선택"
                      : "(시도 먼저 선택)"}
                </option>
                {sigungus.map((s) => (
                  <option key={s.code} value={s.label}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="읍면동">
              <select
                value={params.emdong}
                disabled={!params.sigunguCode || eupmsLoading}
                onChange={(e) =>
                  setParams((p) => ({ ...p, emdong: e.target.value }))
                }
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-amber-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">
                  {!params.sigunguCode
                    ? "(시군구 먼저 선택)"
                    : eupmsLoading
                    ? "불러오는 중…"
                    : "전체 (선택 안 함)"}
                </option>
                {eupms.map((x) => (
                  <option key={x.code} value={x.label}>
                    {x.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        {/* 카테고리(용도) — 영업 2순위 축. 채널별로 다른 셀렉터 사용.
            · court: CourtCategorySelector (court 분류 트리 직접 사용, 검증됨)
            · hyphen: 기존 6그룹 칩 (Hyphen yongdo 59종 기반, 백업 채널) */}
        <Section title="카테고리">
          {channel === "court" ? (
            <CourtCategorySelector
              sclCodes={params.courtSclCodes}
              onChange={(next) =>
                setParams((p) => ({ ...p, courtSclCodes: next }))
              }
            />
          ) : (
          <div className="space-y-1.5">
            {/* [전체] — 빈 배열 = 전체 의미. 그룹 칩과 동일 알약형. */}
            <div className="flex flex-wrap gap-1">
              {(() => {
                const isAll = params.yongdoCodes.length === 0;
                return (
                  <button
                    type="button"
                    onClick={() => setParams((p) => ({ ...p, yongdoCodes: [] }))}
                    className={`text-[11px] px-3 py-1 leading-none rounded-full border font-semibold transition-colors ${
                      isAll
                        ? "bg-amber-50 text-amber-700 border-amber-300"
                        : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {isAll ? "✓ " : ""}
                    전체
                  </button>
                );
              })()}
            </div>

            {/* 그룹 칩 */}
            <div className="flex flex-wrap gap-1">
              {AUCTION_CATEGORY_GROUP_ORDER.map((group) => {
                const groupCodes = AUCTION_CATEGORY_GROUPS[group];
                const groupSelectedCount = groupCodes.filter((c) =>
                  params.yongdoCodes.includes(c),
                ).length;
                const allOn = groupSelectedCount === groupCodes.length;
                const partialOn =
                  groupSelectedCount > 0 && groupSelectedCount < groupCodes.length;
                const isExpanded = expandedGroup === group;

                // 알약형 단일 칩 — 좌측 본체(그룹 토글) + 우측 화살표(펼침).
                // 두 클릭 영역은 분리되지만 시각적으로 한 덩어리.
                const containerClass = allOn
                  ? "border-amber-300 bg-amber-50 text-amber-700"
                  : partialOn
                  ? "border-amber-200 bg-amber-50/60 text-amber-700"
                  : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50";

                return (
                  <div
                    key={group}
                    className={`inline-flex items-center rounded-full border transition-colors ${containerClass}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleGroup(group)}
                      title={AUCTION_GROUP_LABEL[group].sub}
                      className="text-[11px] pl-2.5 pr-1 py-1 leading-none font-semibold rounded-l-full"
                    >
                      {allOn ? "✓ " : partialOn ? "◐ " : ""}
                      {AUCTION_GROUP_LABEL[group].label}
                      {partialOn && (
                        <span className="text-[9px] ml-0.5 tabular-nums opacity-80">
                          ({groupSelectedCount}/{groupCodes.length})
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedGroup(isExpanded ? null : group)}
                      title={isExpanded ? "접기" : "개별 선택"}
                      className={`text-[10px] pr-2 pl-0.5 py-1 leading-none rounded-r-full transition-colors ${
                        isExpanded
                          ? "text-amber-700"
                          : "text-gray-400 hover:text-amber-700"
                      }`}
                    >
                      {isExpanded ? "▴" : "▾"}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* 그룹 펼침 — 개별 yongdo 코드 칩 */}
            {expandedGroup && (
              <div className="p-2 bg-amber-50/40 border border-amber-200 rounded space-y-1">
                <div className="text-[10px] text-amber-700 font-semibold">
                  {AUCTION_GROUP_LABEL[expandedGroup].label} —{" "}
                  {AUCTION_GROUP_LABEL[expandedGroup].sub}
                </div>
                <div className="flex flex-wrap gap-1">
                  {AUCTION_CATEGORY_GROUPS[expandedGroup].map((code) => {
                    const checked = params.yongdoCodes.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => toggleYongdo(code)}
                        className={`text-[10px] px-2.5 py-0.5 leading-none rounded-full border transition-colors ${
                          checked
                            ? "bg-amber-600 text-white border-amber-700 font-semibold"
                            : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        {checked ? "✓ " : ""}
                        {AUCTION_YONGDO_LABEL[code] ?? code}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          )}
        </Section>

        {/* 진행상태 — 영업 핵심 필터.
            v5 검증 응답 등장값: 신건/진행/유찰/매각/취하 (+변경/정지 가능).
            기본 ON = 신건+진행+유찰 (입찰 가능 매물). 응답 후 클라이언트 사이드 필터. */}
        <Section title="진행 상태">
          <div className="flex flex-wrap gap-1">
            {PROGRESS_STATUS_OPTIONS.map((status) => {
              const checked = params.progressStatus.includes(status);
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => toggleProgressStatus(status)}
                  className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                    checked
                      ? "bg-amber-50 text-amber-700 border-amber-300 font-semibold"
                      : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {checked ? "✓ " : ""}
                  {status}
                </button>
              );
            })}
          </div>
          <div className="text-[10px] text-gray-400 mt-1 leading-snug">
            ※ 신건/진행/유찰 = 입찰 가능. 매각/취하 = 종결.
          </div>
        </Section>

        {/* 매각기일 — 영업 1순위 필터.
            v5 검증 결과 필터 없으면 응답이 종결건 위주라, 미래 윈도우 좁힘 필수.
            기본 = 오늘 ~ +6개월 (모델 EMPTY_PARAMS 가 자동 세팅). */}
        <Section title="매각기일">
          <div className="space-y-1.5">
            <Field label="시작">
              <input
                type="date"
                value={params.bidStart ?? ""}
                onChange={(e) =>
                  setParams((p) => ({
                    ...p,
                    bidStart: e.target.value || null,
                  }))
                }
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-amber-500 focus:outline-none"
              />
            </Field>
            <Field label="종료">
              <input
                type="date"
                value={params.bidEnd ?? ""}
                onChange={(e) =>
                  setParams((p) => ({
                    ...p,
                    bidEnd: e.target.value || null,
                  }))
                }
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-amber-500 focus:outline-none"
              />
            </Field>
            <div className="flex gap-1 pt-0.5">
              <QuickRangeButton label="오늘~1개월" onClick={() => setParams((p) => ({ ...p, ...rangeFromToday(1) }))} />
              <QuickRangeButton label="3개월" onClick={() => setParams((p) => ({ ...p, ...rangeFromToday(3) }))} />
              <QuickRangeButton label="6개월" onClick={() => setParams((p) => ({ ...p, ...rangeFromToday(6) }))} />
            </div>
          </div>
        </Section>

        {/* 고급 필터 — 모바일 시각 부담 줄임. 평소엔 접힘.
            의뢰자 결정(2026-05-03): 감정가/토지/건물/할인율 4개. */}
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="w-full text-[11px] py-1 text-gray-500 hover:text-amber-700 border border-dashed border-gray-300 hover:border-amber-300 rounded transition-colors"
        >
          {showAdvanced
            ? "▴ 고급 필터 접기"
            : "▾ 고급 필터 (감정가·면적·할인율)"}
        </button>

        {showAdvanced && (
          <div className="space-y-2.5 px-1">
            <RangeField
              label="감정가 (만원)"
              minVal={params.gamMin}
              maxVal={params.gamMax}
              onChange={(min, max) =>
                setParams((p) => ({ ...p, gamMin: min, gamMax: max }))
              }
            />
            <RangeField
              label="토지면적 (㎡)"
              minVal={params.landMin}
              maxVal={params.landMax}
              onChange={(min, max) =>
                setParams((p) => ({ ...p, landMin: min, landMax: max }))
              }
            />
            <RangeField
              label="건물면적 (㎡)"
              minVal={params.bareaMin}
              maxVal={params.bareaMax}
              onChange={(min, max) =>
                setParams((p) => ({ ...p, bareaMin: min, bareaMax: max }))
              }
            />
            <RangeField
              label="할인율 (%)"
              minVal={params.discountMin}
              maxVal={params.discountMax}
              onChange={(min, max) =>
                setParams((p) => ({ ...p, discountMin: min, discountMax: max }))
              }
              hint="감정가 대비 % 할인 (예: 30 = 30%↓)"
            />
          </div>
        )}

        <div className="text-[10px] text-gray-500 leading-snug px-0.5">
          ※ Hyphen 호출 비용 절감을 위해 <b>시군구</b>까지 좁혀야 검색 가능합니다.
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={runSearch}
            disabled={!canSearch}
            className="flex-1 text-xs font-bold py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white rounded shadow-sm flex items-center justify-center gap-1.5"
          >
            {searching ? (
              <>
                <span className="w-3 h-3 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                조회 중...
              </>
            ) : (
              <>🔍 검색</>
            )}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={searching}
            className="text-xs py-2 px-3 bg-white text-gray-600 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 rounded"
          >
            초기화
          </button>
        </div>
      </div>
      )}

      {/* 검색창 접기/펼치기 토글 — 가로 길게. 사용자가 결과 영역 확보용으로 직접 조작. */}
      <button
        type="button"
        onClick={() => setPanelCollapsed((v) => !v)}
        title={panelCollapsed ? "검색조건 펼치기" : "검색조건 접기"}
        className="w-full py-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border-y border-amber-200 transition-colors flex items-center justify-center gap-1.5"
      >
        {panelCollapsed ? (
          <>
            <span className="text-[13px] leading-none">▾</span>
            <span>검색조건 펼치기</span>
          </>
        ) : (
          <>
            <span className="text-[13px] leading-none">▴</span>
            <span>검색조건 접기</span>
          </>
        )}
      </button>

      {/* 결과 영역 — 매물 카드 리스트 */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-700 flex items-center justify-between gap-2 border-b border-gray-200 bg-gray-50">
          <span className="tabular-nums">
            매물 {results.length.toLocaleString()}건
            {totalCountAll != null && totalCountAll !== results.length && (
              <span className="text-gray-400 ml-1 font-normal">
                / 전체 {totalCountAll.toLocaleString()}
              </span>
            )}
          </span>
          {results.length > 0 && (
            <span className="inline-flex rounded-md overflow-hidden border border-amber-200 text-[10px]">
              <button
                type="button"
                onClick={() => setViewMode("jibun")}
                className={`px-2 py-0.5 transition-colors ${
                  viewMode === "jibun"
                    ? "bg-amber-600 text-white"
                    : "bg-white text-amber-700 hover:bg-amber-50"
                }`}
                title="지번별로 모두 표시"
              >
                지번별
              </button>
              <button
                type="button"
                onClick={() => setViewMode("case")}
                className={`px-2 py-0.5 transition-colors ${
                  viewMode === "case"
                    ? "bg-amber-600 text-white"
                    : "bg-white text-amber-700 hover:bg-amber-50"
                }`}
                title="같은 사건 묶어 표시 (일괄매각 한눈에)"
              >
                사건별
              </button>
            </span>
          )}
        </div>

        {/* apiStatus 비정상 배너 */}
        {apiStatus && apiStatus !== "ok" && apiStatus !== "empty" && (
          <ApiStatusBanner status={apiStatus} />
        )}

        {/* truncated 안내 (20페이지 cap 초과) */}
        {truncated && (
          <div className="px-3 py-2 text-[11px] text-amber-800 bg-amber-50 border-b border-amber-200 leading-snug">
            ⚠️ 매물이 많아 일부만 표시됨 (20페이지 cap). 시군구·카테고리·면적으로 좁혀주세요.
          </div>
        )}

        <div className="overflow-y-auto flex-1">
          {searching ? (
            <div className="p-4 text-center text-xs text-gray-500 flex flex-col items-center gap-2">
              <span className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              매물 조회 중...
              <span className="text-[10px] text-gray-400">
                (테스트 모드 20초 대기 가능 — 카테고리 다중 시 더 길어짐)
              </span>
            </div>
          ) : error ? (
            <div className="p-4 text-center text-xs text-red-600">
              조회 실패: {error}
            </div>
          ) : results.length === 0 ? (
            <div className="p-4 text-center text-xs text-gray-400 leading-relaxed">
              {params.sigunguCode === "" ? (
                <>지역(시군구)을 선택하고 [검색] 버튼을 눌러주세요</>
              ) : (
                <>검색 결과 0건</>
              )}
            </div>
          ) : viewMode === "case" ? (
            groupByCase(results).map((g) => (
              <CaseGroupCard
                key={g.key}
                group={g}
                onClick={() => onItemClick?.(g.representative)}
              />
            ))
          ) : (
            results.map((it) => (
              <ResultCard
                key={it.경매번호}
                item={it}
                onClick={() => onItemClick?.(it)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────
// 보조 컴포넌트 — 모드별 패널이 동일한 시각으로 보이도록 통일
// (다음 단계에서 lib/modes/components/ 로 추출 후 모드 간 공유)
// ───────────────────────────────────────────────

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
      <span className="text-[11px] text-gray-500 w-14 shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

/** min~max 숫자 RangeField — 고급 필터 안 4종 공통. */
function RangeField({
  label,
  minVal,
  maxVal,
  onChange,
  hint,
}: {
  label: string;
  minVal: number | null;
  maxVal: number | null;
  onChange: (min: number | null, max: number | null) => void;
  hint?: string;
}) {
  return (
    <div>
      <Field label={label}>
        <div className="flex items-center gap-1">
          <input
            type="number"
            placeholder="최소"
            value={minVal ?? ""}
            onChange={(e) =>
              onChange(
                e.target.value === "" ? null : Number(e.target.value),
                maxVal,
              )
            }
            className="w-full min-w-0 text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 tabular-nums focus:border-amber-500 focus:outline-none"
          />
          <span className="text-xs text-gray-400">~</span>
          <input
            type="number"
            placeholder="최대"
            value={maxVal ?? ""}
            onChange={(e) =>
              onChange(
                minVal,
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
            className="w-full min-w-0 text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 tabular-nums focus:border-amber-500 focus:outline-none"
          />
        </div>
      </Field>
      {hint && (
        <div className="text-[10px] text-gray-400 leading-snug mt-0.5 ml-16">
          {hint}
        </div>
      )}
    </div>
  );
}

/** 매각기일 빠른 범위 버튼 — "3개월" 클릭 = 오늘 ~ +3개월 */
function QuickRangeButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-600 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700 transition-colors"
    >
      {label}
    </button>
  );
}

/** KST 오늘 ~ +N개월 윈도우 (YYYY-MM-DD). 모델의 computeDefaultBidWindow 와 동일 시각 기준. */
function rangeFromToday(months: number): { bidStart: string; bidEnd: string } {
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const start = kstNow.toISOString().slice(0, 10);
  const future = new Date(kstNow);
  future.setUTCMonth(future.getUTCMonth() + months);
  const end = future.toISOString().slice(0, 10);
  return { bidStart: start, bidEnd: end };
}

/**
 * `대표소재지` 도로명주소에서 호수/동 정보 추출.
 *
 * 예시:
 *   "경기도 고양시 일산서구 주엽로 80, 1층비146호 (대화동, ...)"
 *     → "1층비146호"
 *   "서울특별시 강남구 테헤란로 152, 강남파이낸스센터 5층502호"
 *     → "강남파이낸스센터 5층502호"
 *   "경기도 김포시 월곶면 고막리 144-11" (지번주소만, 호수 없음)
 *     → null
 *
 * 규칙: 첫 콤마 다음 ~ 괄호(또는 끝) 전. 호수 키워드(층/호/동) 가 없으면 null.
 */
function extractUnitFromAddress(addr: string | null | undefined): string | null {
  if (!addr) return null;
  // 첫 콤마 위치
  const commaIdx = addr.indexOf(",");
  if (commaIdx === -1) return null;
  // 콤마 이후
  const afterComma = addr.slice(commaIdx + 1);
  // 괄호 전까지
  const parenIdx = afterComma.indexOf("(");
  const segment = (parenIdx === -1 ? afterComma : afterComma.slice(0, parenIdx)).trim();
  if (!segment) return null;
  // 호수 키워드 검증 — 층/호/동/호실 중 하나라도 포함해야 의미 있는 호수 정보
  if (!/[층호동]/.test(segment)) return null;
  return segment;
}

// ───────────────────────────────────────────────
// 결과 카드 — 영업담당자 한눈 평가 가능 형식
// ───────────────────────────────────────────────

/**
 * 매물 1건 카드.
 *
 * 시각 위계 (영업 시점 우선순위):
 *   1) 사건명칭 (가장 큰 글자) — 영업 키
 *   2) 감정가 (큰 글자, 절대값)
 *   3) 할인율% (강조 — 차별화 포인트)
 *   4) D-day (D-3 이내 빨강 깜빡)
 *   5) 면적 / 유찰 / 위치 — 작은 글자
 *
 * 우측 = 지번 핀 (📍 197-1) — 클릭 시 해당 지번 진입 (D3/D4 단계).
 */
function ResultCard({
  item,
  onClick,
}: {
  item: AuctionListItem;
  onClick: () => void;
}) {
  const discountPct = Math.round(item.discountRatio * 100);
  const jibun = item.pnuStandard ? jibunFromPnu(item.pnuStandard) ?? null : null;

  /**
   * 호수/동 정보 — 같은 빌딩 다른 호수 매물 구분 핵심.
   *
   * Hyphen 응답 검증(2026-05-03): 한 사건에 5개 호수 매물이 들어오는 케이스 발견.
   * 사건명칭/지번/면적/감정가가 모두 같고 호수만 다르면 카드 시각상 구분 불가.
   *
   * 추출 규칙 — `대표소재지` 도로명주소에서 호수 부분 분리:
   *   "경기도 고양시 일산서구 주엽로 80, 1층비146호 (대화동, ...)"
   *   → 콤마 다음 ~ 괄호 전 = "1층비146호"
   *   호수 정보 없는 매물(토지 등)은 null 반환.
   */
  const unitText = extractUnitFromAddress(item.대표소재지);
  /** 한 사건에 여러 물건일 때만 배지 — 단일 물건이면 노이즈라 숨김 */
  const showUnitBadge = (item.물건번호갯수 ?? 1) > 1;
  /**
   * Court 채널 합쳐진 카드는 mokGbncd 분류별 카운트로 표시 — "토지 N·건물 N·집합 N".
   * hyphen 채널 또는 court 단일 row 면 undefined → 기존 분수 표시 fallback.
   */
  const groupBadgeText = (() => {
    if (!item.groupBreakdown) return null;
    const { land, building, aggregate } = item.groupBreakdown;
    const parts: string[] = [];
    if (land > 0) parts.push(`토지 ${land}`);
    if (building > 0) parts.push(`건물 ${building}`);
    if (aggregate > 0) parts.push(`집합 ${aggregate}`);
    return parts.length > 0 ? parts.join("·") : null;
  })();

  // 면적: 토지/건물 중 큰 쪽 우선. 둘 다 없으면 생략.
  const areaText = (() => {
    const land = item.토지면적;
    const bld = item.건물면적;
    if (bld != null && bld > 0 && (land == null || bld >= land)) {
      return `건물 ${Math.round(bld).toLocaleString()}㎡`;
    }
    if (land != null && land > 0) {
      return `토지 ${Math.round(land).toLocaleString()}㎡`;
    }
    return null;
  })();

  // D-day 색상 — D-3 빨강 깜빡, D-7 주황, 그 외 회색.
  const dayBadge = (() => {
    if (item.daysLeft < 0) return { cls: "text-gray-400", label: "마감" };
    if (item.daysLeft <= 3)
      return {
        cls: "text-red-600 font-bold animate-pulse",
        label: `D-${item.daysLeft}`,
      };
    if (item.daysLeft <= 7)
      return { cls: "text-amber-600 font-semibold", label: `D-${item.daysLeft}` };
    return { cls: "text-gray-500", label: `D-${item.daysLeft}` };
  })();

  // 진행상태 배지 색상 — 영업 매력도순.
  const statusBadgeCls = (() => {
    switch (item.진행상태) {
      case "신건":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "진행":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "유찰":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "매각":
      case "취하":
        return "bg-gray-100 text-gray-500 border-gray-200";
      default:
        return "bg-gray-50 text-gray-600 border-gray-200";
    }
  })();

  return (
    <div className="w-full px-3 py-2.5 border-b border-gray-200 bg-white hover:bg-amber-50 transition-colors">
      <div className="flex items-stretch gap-2">
        {/* 좌측 본문 */}
        <button
          type="button"
          onClick={onClick}
          className="flex-1 min-w-0 text-left active:opacity-70"
        >
          {/* 1줄: 진행상태 + 용도 + 법원 + 위치 */}
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span
              className={`text-[10px] font-semibold px-1.5 py-px rounded border ${statusBadgeCls}`}
            >
              {item.진행상태}
            </span>
            {item.용도 && (
              <span className="text-[10px] text-gray-600 font-medium">
                {item.용도}
              </span>
            )}
            <span className="text-[10px] text-gray-300">·</span>
            <span className="text-[10px] text-gray-500">
              {item.법원간략명}지원
            </span>
            <span className="text-[10px] text-gray-400 ml-auto truncate">
              유찰 {item.유찰수}회
            </span>
          </div>

          {/* 2줄: 사건명칭 + 물건번호 배지 (한 사건에 다물건일 때만) */}
          <div className="flex items-baseline gap-1.5 mb-0.5">
            <span className="text-[12px] text-gray-900 font-bold leading-tight">
              {item.사건명칭}
            </span>
            {showUnitBadge &&
              (groupBadgeText ? (
                <span className="text-[9px] font-semibold px-1 py-px rounded bg-gray-100 text-gray-600 border border-gray-200 leading-none">
                  {groupBadgeText}
                </span>
              ) : (
                <span className="text-[9px] font-semibold px-1 py-px rounded bg-gray-100 text-gray-600 border border-gray-200 leading-none">
                  물건 {item.물건번호}/{item.물건번호갯수}
                </span>
              ))}
          </div>

          {/* 호수 정보 — 같은 빌딩 다른 호수 매물 시각 구분 (도로명 빌딩 매물만) */}
          {unitText && (
            <div className="text-[11px] text-amber-700 font-semibold leading-tight mb-1">
              🏢 {unitText}
            </div>
          )}

          {/* 3줄: 감정가 → 최저가 + 할인율 */}
          <div className="flex items-baseline gap-1.5 mb-1 flex-wrap">
            <span className="text-[10px] text-gray-500">감정</span>
            <span className="text-[12px] text-gray-600 tabular-nums leading-none">
              {formatWon(item.감정가)}
            </span>
            <span className="text-gray-300 text-[11px]">→</span>
            <span className="text-[10px] text-gray-500">최저</span>
            <span className="text-[14px] font-bold text-gray-900 tabular-nums leading-none">
              {formatWon(item.최저가)}
            </span>
            {discountPct > 0 && (
              <span className="text-[12px] font-bold text-rose-600 tabular-nums leading-none">
                -{discountPct}%
              </span>
            )}
          </div>

          {/* 4줄: 면적 */}
          {areaText && (
            <div className="flex items-center gap-1.5 text-[11px] text-gray-600 mb-0.5">
              <span>{areaText}</span>
            </div>
          )}

          {/* 5줄: 매각기일 + D-day */}
          <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
            <span>매각</span>
            <span className="tabular-nums">
              {item.매각기일일자 ?? item.매각기일.slice(0, 10)}
            </span>
            <span className={`tabular-nums ${dayBadge.cls}`}>
              {dayBadge.label}
            </span>
          </div>
        </button>

        {/* 우측 — 📍 지번 핀 */}
        {jibun && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
            className="flex-shrink-0 inline-flex items-center gap-0.5 self-center px-2 py-1 rounded text-amber-600 font-semibold hover:bg-amber-100 active:bg-amber-200 transition-colors text-xs"
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

// ───────────────────────────────────────────────
// API 상태 배너 — 인증실패/잔액부족/레이트리밋/일시장애 안내
// ───────────────────────────────────────────────

function ApiStatusBanner({ status }: { status: string }) {
  const cfg: Record<string, { cls: string; icon: string; msg: string }> = {
    auth_failed: {
      cls: "bg-red-50 border-red-200 text-red-700",
      icon: "🔒",
      msg: "Hyphen 인증 실패 — 결제 만료 또는 키 오류. 비즈머니 충전이 필요합니다.",
    },
    no_permission: {
      cls: "bg-amber-50 border-amber-200 text-amber-800",
      icon: "⚠️",
      msg: "Hyphen 운영 모드 권한 미신청. 테스트 모드로 자동 전환됩니다.",
    },
    rate_limited: {
      cls: "bg-amber-50 border-amber-200 text-amber-800",
      icon: "⏱",
      msg: "테스트 모드 20초 제한. 잠시 후 재시도해주세요.",
    },
    insufficient_balance: {
      cls: "bg-red-50 border-red-200 text-red-700",
      icon: "💳",
      msg: "Hyphen 비즈머니 부족 — 충전 후 재시도.",
    },
    unavailable: {
      cls: "bg-gray-50 border-gray-200 text-gray-700",
      icon: "📡",
      msg: "Hyphen 서비스 일시 장애. 잠시 후 재시도.",
    },
  };
  const c = cfg[status] ?? cfg.unavailable;

  return (
    <div
      className={`px-3 py-2 text-[11px] border-b leading-snug flex gap-2 ${c.cls}`}
    >
      <span className="flex-shrink-0">{c.icon}</span>
      <span>{c.msg}</span>
    </div>
  );
}

// ───────────────────────────────────────────────
// 사건별 그룹핑 — 같은 (법원코드, 사건년도, 사건번호) row 들을 한 카드로 묶음
// 후처리만 (API 호출 0). 일괄매각 가시화용.
// ───────────────────────────────────────────────

interface CaseGroup {
  key: string;
  /** 같은 사건의 모든 매물 (지번 다름 포함) */
  items: AuctionListItem[];
  /** 카드 클릭 시 사용할 대표 매물 — 면적 큰 토지 우선 */
  representative: AuctionListItem;
  /** 합산 토지 면적 (㎡) */
  landTotal: number;
  /** 합산 건물 면적 (㎡) */
  buildingTotal: number;
  /** 분류별 카운트 — 카드의 그룹배지와 같은 형식 */
  breakdown: { land: number; building: number; aggregate: number };
}

function groupByCase(items: AuctionListItem[]): CaseGroup[] {
  const map = new Map<string, AuctionListItem[]>();
  const keys: string[] = [];
  for (const it of items) {
    const key = `${it.법원코드}|${it.사건년도}|${it.사건번호}`;
    if (!map.has(key)) {
      map.set(key, []);
      keys.push(key);
    }
    map.get(key)!.push(it);
  }
  return keys.map((key) => {
    const list = map.get(key)!;
    // 대표 매물 — 토지면적 큰 쪽 우선, 없으면 첫 매물
    const representative = [...list].sort((a, b) => {
      const al = a.토지면적 ?? 0;
      const bl = b.토지면적 ?? 0;
      return bl - al;
    })[0];
    let landTotal = 0;
    let buildingTotal = 0;
    let land = 0;
    let building = 0;
    let aggregate = 0;
    for (const it of list) {
      if (it.토지면적 != null) landTotal += it.토지면적;
      if (it.건물면적 != null) buildingTotal += it.건물면적;
      // groupBreakdown 박힌 매물(court 합쳐진 카드)은 그것 우선, 아니면 면적/용도로 추정
      if (it.groupBreakdown) {
        land += it.groupBreakdown.land;
        building += it.groupBreakdown.building;
        aggregate += it.groupBreakdown.aggregate;
      } else if (it.토지면적 != null && it.토지면적 > 0) {
        land += 1;
      } else if (it.건물면적 != null && it.건물면적 > 0) {
        building += 1;
      }
    }
    return {
      key,
      items: list,
      representative,
      landTotal,
      buildingTotal,
      breakdown: { land, building, aggregate },
    };
  });
}

function CaseGroupCard({
  group,
  onClick,
}: {
  group: CaseGroup;
  onClick: () => void;
}) {
  const rep = group.representative;
  const repJibun = rep.pnuStandard ? jibunFromPnu(rep.pnuStandard) : null;
  const otherCount = group.items.length - 1;

  const discountPct = Math.round(rep.discountRatio * 100);

  // 분류별 카운트 라벨 ("토지 4·건물 2") — 0인 분류 생략
  const breakdownLabel = (() => {
    const { land, building, aggregate } = group.breakdown;
    const parts: string[] = [];
    if (land > 0) parts.push(`토지 ${land}`);
    if (building > 0) parts.push(`건물 ${building}`);
    if (aggregate > 0) parts.push(`집합 ${aggregate}`);
    return parts.length > 0 ? parts.join("·") : null;
  })();

  // 진행상태 배지 (대표 매물 기준)
  const statusBadgeCls = (() => {
    switch (rep.진행상태) {
      case "신건":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "진행":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "유찰":
        return "bg-amber-50 text-amber-700 border-amber-200";
      default:
        return "bg-gray-100 text-gray-500 border-gray-200";
    }
  })();

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-3 py-2.5 text-left border-b border-gray-200 bg-white hover:bg-amber-50 transition-colors active:opacity-70"
    >
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        <span
          className={`text-[10px] font-semibold px-1.5 py-px rounded border ${statusBadgeCls}`}
        >
          {rep.진행상태}
        </span>
        {breakdownLabel && (
          <span className="text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-px rounded">
            {breakdownLabel}
          </span>
        )}
        <span className="text-[10px] text-gray-500">{rep.법원간략명}</span>
      </div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-sm font-bold text-gray-900 tabular-nums">
          {rep.사건명칭}
        </span>
        <span className="text-[11px] text-gray-500 truncate">
          {repJibun ?? ""}
          {otherCount > 0 ? ` 외 ${otherCount}필지` : ""}
        </span>
      </div>
      <div className="flex items-baseline gap-2 text-[12px]">
        <span className="text-gray-400">감정</span>
        <span className="tabular-nums text-gray-600">
          {formatWon(rep.감정가)}
        </span>
        <span className="text-gray-300">→</span>
        <span className="text-gray-400">최저</span>
        <span className="tabular-nums font-bold text-gray-900">
          {formatWon(rep.최저가)}
        </span>
        {discountPct > 0 && (
          <span className="ml-auto text-[11px] font-bold text-red-600 tabular-nums">
            -{discountPct}%
          </span>
        )}
      </div>
      {(group.landTotal > 0 || group.buildingTotal > 0) && (
        <div className="mt-1 text-[10px] text-gray-500 tabular-nums">
          {group.landTotal > 0 && `토지합 ${Math.round(group.landTotal).toLocaleString()}㎡`}
          {group.landTotal > 0 && group.buildingTotal > 0 && " · "}
          {group.buildingTotal > 0 && `건물합 ${Math.round(group.buildingTotal).toLocaleString()}㎡`}
        </div>
      )}
    </button>
  );
}
