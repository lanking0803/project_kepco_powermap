"use client";

/**
 * 자연취락지구 모드 검색 패널 — Sidebar 안에 inline 으로 들어감.
 *
 * 외곽 컨테이너/헤더는 부모 Sidebar 가 제공 (= OnbidSearchPanel 패턴 미러).
 *
 * 데이터 흐름:
 *   1. /api/regions/sigungu → 시도/시군구 드롭다운 (atomic, 30일 CDN)
 *   2. 검색 → /api/uq-villages/by-bjd?bjd_code=... 호출
 *   3. matchUqWithNearestVillages — 직경×5 임계값 안 마을 Top 3 매칭
 *   4. 결과 카드 표시. 카드 클릭 → onItemClick(row) → MapClient 가 마을 진입
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
import { fetchSigungus, type SigunguEntry } from "@/lib/api/regions";
import { fetchVworldUqVillagesByQuery } from "@/lib/api/vworld";
import { getUqQuerySggCodes } from "@/lib/uq/sgg-strategy";
import {
  matchUqWithNearestVillages,
  type UqVillageWithMatches,
  type NearVillage,
} from "@/lib/uq/match-village";
import type { LatIndex } from "@/lib/uq/sorted-by-lat";
import type { MapSummaryRow } from "@/lib/types";

const MODE_ID = "uq";

interface Props {
  /** 위도순 정렬된 마을 인덱스 — 백그라운드 빌드, BBox 매칭용. */
  latIndex: LatIndex | null;
  /** 칩(매칭 마을명) 클릭 — MapClient 가 마을 마커 클릭 핸들러로 위임 */
  onItemClick?: (row: MapSummaryRow) => void;
  /**
   * 카드 본체 클릭 — 그 취락지구 1개 폴리곤만 시각 강조 + 카메라 이동.
   * 마을 진입 X. 영업이 폴리곤 자체를 보고 판단하고 싶을 때.
   */
  onPolygonFocus?: (village: {
    polygon: number[][][];
    center: { lat: number; lng: number };
  }) => void;
}

export default function UqVillageSearchPanel({
  latIndex,
  onItemClick,
  onPolygonFocus,
}: Props) {
  const persisted =
    typeof window !== "undefined"
      ? loadModeState<UqPersistedState>(MODE_ID)
      : null;

  const [params, setParams] = useState<UqSearchParams>(
    persisted?.params ?? UQ_EMPTY_PARAMS,
  );
  /**
   * 검색 결과 (매칭 정보 포함). 새로고침 시 sessionStorage 로 복원.
   * 구 sessionStorage 데이터(matches 미보유) 안전 보강 — 빈 배열로 채워 폭발 방지.
   */
  const [results, setResults] = useState<UqVillageWithMatches[]>(() => {
    const raw = persisted?.results ?? [];
    return raw.map((v) => ({ ...v, matches: v.matches ?? [] }));
  });
  /** 검색 1회라도 실행됐나 — 검색 전 안내 vs 0건 안내 구분. */
  const [hasSearched, setHasSearched] = useState(
    (persisted?.results?.length ?? 0) > 0,
  );
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  /** 시군구 마스터 — 마운트 시 1회 lazy fetch. 이후 모듈 캐시 hit. */
  const [allSigungus, setAllSigungus] = useState<SigunguEntry[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchSigungus()
      .then((items) => {
        if (alive) setAllSigungus(items);
      })
      .catch((e) => {
        console.error("[UqVillageSearchPanel] 시군구 로드 실패", e);
      })
      .finally(() => {
        if (alive) setRegionsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** 시도 목록 — 한국 표준 17개. 입력 데이터 안정 정렬. */
  const sidos = useMemo(() => {
    const set = new Set<string>();
    for (const r of allSigungus) set.add(r.sido);
    return [...set];
  }, [allSigungus]);

  /** 선택 시도의 시군구 목록 — label 은 백엔드 통합 표기값. */
  const sigungus = useMemo(() => {
    if (!params.sido) return [] as Array<{ label: string; code: string }>;
    return allSigungus
      .filter((r) => r.sido === params.sido)
      .map((r) => ({ label: r.label, code: r.code }));
  }, [allSigungus, params.sido]);

  /** 시도 변경 또는 데이터 갱신 시 — 무효 시군구는 자동 초기화. */
  useEffect(() => {
    if (!params.sigungu) return;
    const stillValid = sigungus.some((s) => s.label === params.sigungu);
    if (!stillValid) {
      setParams((p) => ({ ...p, sigungu: "", sigunguCode: "" }));
    }
  }, [sigungus, params.sigungu]);

  const canSearch = params.sigunguCode !== "" && !searching;

  /**
   * 검색 — VWorld 등록 단위 함정(일반시 일반구) 우회를 위해 sgg-strategy 가
   * 결정한 1~2개 코드 모두 호출하고 합친다. 자연취락지구만 필터(서버 lib).
   *
   * 매칭은 사용자가 선택한 시군구 5자리(sigunguCode) prefix 마을만 후보 →
   * 일반시 일반구 검색 시 시 단위 응답에서 자동으로 그 구 영역만 노출됨.
   */
  const runSearch = async () => {
    if (!canSearch) return;
    setSearching(true);
    setSearchError(null);
    setHasSearched(true);
    try {
      const queryCodes = getUqQuerySggCodes(params.sigunguCode);
      const items = await fetchVworldUqVillagesByQuery(queryCodes);
      const sorted = [...items].sort((a, b) => b.area_m2 - a.area_m2);
      const matched = matchUqWithNearestVillages(sorted, latIndex);
      setResults(matched);
      saveModeState<UqPersistedState>(MODE_ID, { params, results: matched });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSearchError(msg);
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const reset = () => {
    setParams(UQ_EMPTY_PARAMS);
    setResults([]);
    setSearchError(null);
    setHasSearched(false);
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
                disabled={regionsLoading}
                onChange={(e) =>
                  setParams((p) => ({
                    ...p,
                    sido: e.target.value,
                    sigungu: "",
                    sigunguCode: "",
                  }))
                }
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-emerald-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">
                  {regionsLoading ? "불러오는 중…" : "선택"}
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
                disabled={!params.sido || regionsLoading}
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

      {/* 결과 헤더 — 결과 카운트만 한 줄 표시 */}
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
        <span className="text-xs font-bold text-gray-700">결과</span>
        <span className="text-xs text-gray-500">
          {searching
            ? "검색 중…"
            : results.length > 0
            ? `${results.length}곳`
            : "—"}
        </span>
      </div>

      {/* 결과 카드 리스트 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5">
        {searchError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
            ⚠️ {searchError}
          </p>
        )}
        {!searching && !searchError && results.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-8 leading-relaxed">
            {hasSearched ? (
              <>
                이 시군구에는 자연취락지구가 없습니다.
                <br />
                다른 시군구를 시도해보세요.
              </>
            ) : (
              "시도/시군구를 선택하고 [검색] 버튼을 눌러주세요."
            )}
          </p>
        )}
        {results.map((v, i) => (
          <UqResultCard
            key={v.mnum || i}
            index={i + 1}
            village={v}
            onItemClick={onItemClick}
            onPolygonFocus={onPolygonFocus}
          />
        ))}
      </div>
    </div>
  );
}

/* ── 결과 카드 — 영업 1차 발굴 정보 ── */

interface UqResultCardProps {
  /** 1-based 표시 번호 (지도 ↔ 카드 매칭용) */
  index: number;
  village: UqVillageWithMatches;
  /** 매칭 마을 칩 클릭 — 마을 진입 흐름 (MapClient 가 처리) */
  onItemClick?: (row: MapSummaryRow) => void;
  /** 카드 본체 클릭 — 그 취락지구 폴리곤 1개만 시각 강조 + 카메라 이동 */
  onPolygonFocus?: (village: {
    polygon: number[][][];
    center: { lat: number; lng: number };
  }) => void;
}

function UqResultCard({
  index,
  village,
  onItemClick,
  onPolygonFocus,
}: UqResultCardProps) {
  const pyeong = Math.round(village.area_m2 / PYEONG_PER_M2);
  // matches 가 누락된 옛 sessionStorage 데이터에 대비해 방어
  const matches = village.matches ?? [];

  const handleCardClick = () => {
    onPolygonFocus?.({ polygon: village.polygon, center: village.center });
  };

  return (
    <div
      className="border rounded-md px-2.5 py-2 transition-colors border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50 hover:border-emerald-300 cursor-pointer"
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCardClick();
        }
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-bold text-emerald-800">🏘 #{index}</span>
        <span className="text-sm font-bold text-emerald-900 tabular-nums">
          {pyeong.toLocaleString()}평
        </span>
      </div>

      {/* 매칭된 마을 Top 3 — 하나라도 있으면 표시, 없으면 미매칭 안내 */}
      {matches.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {matches.map((m, i) => (
            <MatchChip
              key={m.bjd_code}
              match={m}
              primary={i === 0}
              onClick={(row) => {
                // 칩 자체 클릭 — 카드 클릭 동일 동작 (이벤트 전파 방지)
                onItemClick?.(row);
              }}
            />
          ))}
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-gray-500">
          근처 마을 데이터 없음 — 지도에서 위치 확인 필요
        </p>
      )}

      <div className="mt-1 flex items-center justify-between text-[11px] text-gray-600 tabular-nums">
        <span>{Math.round(village.area_m2).toLocaleString()}㎡</span>
        {village.dyear && <span>고시 {village.dyear}년</span>}
      </div>
    </div>
  );
}

interface MatchChipProps {
  match: NearVillage;
  primary: boolean;
  onClick: (row: MapSummaryRow) => void;
}

function MatchChip({ match, primary, onClick }: MatchChipProps) {
  const label =
    [match.addr_dong, match.addr_li].filter(Boolean).join(" ") || "마을";
  const distLabel =
    match.distanceM < 1000
      ? `${Math.round(match.distanceM)}m`
      : `${(match.distanceM / 1000).toFixed(1)}km`;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(match.row);
      }}
      className={
        "text-[10px] px-1.5 py-0.5 rounded border transition-colors " +
        (primary
          ? "bg-emerald-100 border-emerald-300 text-emerald-800 hover:bg-emerald-200"
          : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")
      }
      title={`${label} — 약 ${distLabel}`}
    >
      {label} <span className="text-gray-500">· {distLabel}</span>
    </button>
  );
}

/** ㎡ → 평 변환 상수 (1평 = 3.3058㎡, 영업 표준). */
const PYEONG_PER_M2 = 3.3058;

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
