"use client";

/**
 * 상세 목록 — "그룹 보기" 모드.
 *
 * 같은 시설(변전소 · 주변압기 · 배전선로)에 속한 행들을 하나로 묶어서
 * 보여준다. 대부분의 마을은 같은 시설에 수십~수백 지번이 붙어 있어,
 * 지번만 다르고 시설 정보가 계속 반복된다. 그걸 그룹 헤더로 올려주면
 * 사용자는 "이 마을은 거의 다 정상"을 한눈에 파악할 수 있다.
 *
 * 기본 표 뷰(LocationDetailModal 내부)와 나란히 존재하고,
 * 사용자가 상단 토글로 전환한다. 정렬/검색 충돌을 피하기 위해
 * 그룹 내부에서만 번지 정렬한다.
 *
 * 단일 책임: 그룹핑 + 렌더. 데이터 fetch는 부모(LocationDetailModal)에서.
 */

import { useMemo, useState } from "react";
import type { KepcoDataRow } from "@/lib/types";
import { hasCapacity } from "@/lib/types";
import { FacilityCard, StepBlock } from "./FacilityCard";
import { formatRemaining } from "@/lib/summarize";

interface Props {
  rows: KepcoDataRow[];
  onJibunPin?: (row: KepcoDataRow) => void;
  initialSearch?: string;
  /**
   * compact=true: 검색창 + "전부 여유" 배너 숨김. 그룹/테이블만 바로 표시.
   * 사용처: 같은 마을 fallback 처럼 행 수 적고 빠르게 비교가 목적인 경우.
   */
  compact?: boolean;
}

interface FacilityGroup {
  /** 그룹 식별자 (변전소|주변압기|배전선로) */
  key: string;
  substNm: string;
  mtrNo: string;
  dlNm: string;
  rows: KepcoDataRow[];
  /** 부족 카운트 */
  noCap: {
    subst: number;
    mtr: number;
    dl: number;
  };
  /** 전체 부족 상태 */
  status: "ok" | "partial" | "bad";
}

/** 지번 문자열에서 본번을 추출해 정렬용 숫자로 (예: "100-1" → 100) */
function jibunSortKey(jibun: string | null): number {
  if (!jibun) return Number.MAX_SAFE_INTEGER;
  const m = jibun.match(/\d+/);
  return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER;
}

export default function LocationDetailGrouped({ rows, onJibunPin, initialSearch = "", compact = false }: Props) {
  // 기본 "모두 접힘" — 사용자가 그룹 전체 구조를 먼저 파악하도록.
  // null = 모두 접힘, Set = 열린 그룹들(화이트리스트)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [onlyBad, setOnlyBad] = useState(false);
  const [search, setSearch] = useState(initialSearch);

  // ─────────────────────────────────────────────
  // 행들을 (변전소 | 주변압기 | 배전선로) 복합키로 그룹화
  // ─────────────────────────────────────────────
  const groups: FacilityGroup[] = useMemo(() => {
    const map = new Map<string, FacilityGroup>();
    for (const r of rows) {
      const substNm = r.subst_nm ?? "-";
      const mtrNo = r.mtr_no ?? "-";
      const dlNm = r.dl_nm ?? "-";
      const key = `${substNm}||${mtrNo}||${dlNm}`;

      let g = map.get(key);
      if (!g) {
        g = {
          key,
          substNm,
          mtrNo,
          dlNm,
          rows: [],
          noCap: { subst: 0, mtr: 0, dl: 0 },
          status: "ok",
        };
        map.set(key, g);
      }
      g.rows.push(r);
      if (!hasCapacity(r.subst_capa, r.subst_pwr, r.g_subst_capa)) g.noCap.subst++;
      if (!hasCapacity(r.mtr_capa, r.mtr_pwr, r.g_mtr_capa)) g.noCap.mtr++;
      if (!hasCapacity(r.dl_capa, r.dl_pwr, r.g_dl_capa)) g.noCap.dl++;
    }

    // 각 그룹 안에서 번지 오름차순, 상태 판정
    for (const g of map.values()) {
      g.rows.sort((a, b) => jibunSortKey(a.addr_jibun) - jibunSortKey(b.addr_jibun));
      const total = g.rows.length;
      const anyBad =
        g.noCap.subst > 0 || g.noCap.mtr > 0 || g.noCap.dl > 0;
      const allBad =
        g.noCap.subst === total &&
        g.noCap.mtr === total &&
        g.noCap.dl === total;
      g.status = allBad ? "bad" : anyBad ? "partial" : "ok";
    }

    // 그룹 나열 순서: 부족 있는 그룹 먼저 → 건수 많은 순
    return Array.from(map.values()).sort((a, b) => {
      const order = { bad: 0, partial: 1, ok: 2 };
      if (order[a.status] !== order[b.status])
        return order[a.status] - order[b.status];
      return b.rows.length - a.rows.length;
    });
  }, [rows]);

  // 필터: "부족만 보기" + 검색
  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .map((g) => {
        let rows = g.rows;
        if (q) {
          rows = rows.filter(
            (r) =>
              (r.addr_jibun ?? "").toLowerCase().includes(q) ||
              (r.subst_nm ?? "").toLowerCase().includes(q) ||
              (r.dl_nm ?? "").toLowerCase().includes(q) ||
              String(r.mtr_no ?? "").includes(q)
          );
        }
        return { ...g, rows };
      })
      .filter((g) => {
        if (g.rows.length === 0) return false;
        if (onlyBad && g.status === "ok") return false;
        return true;
      });
  }, [groups, onlyBad, search]);

  const toggleGroup = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 모든 그룹이 정상이면 한 줄 요약
  const allOk = groups.length > 0 && groups.every((g) => g.status === "ok");

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 헤더: 검색 + 부족만 보기 토글 — compact 모드에서는 숨김 */}
      {!compact && (
        <div className="px-5 py-3 border-b bg-gray-50 flex items-center gap-3 flex-shrink-0">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="번지, 변전소, 배전선로명 검색..."
            className="flex-1 px-3 py-2 text-base md:text-sm text-gray-900 placeholder:text-gray-400 border border-gray-300 rounded-md bg-white focus:outline-none focus:border-blue-500"
          />
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer whitespace-nowrap select-none">
            <input
              type="checkbox"
              checked={onlyBad}
              onChange={(e) => setOnlyBad(e.target.checked)}
              className="w-3.5 h-3.5 accent-red-500"
            />
            ⚠️ 부족한 것만 보기
          </label>
        </div>
      )}

      {/* 전부 정상 배너 — compact 에서는 숨김 */}
      {!compact && allOk && !search && !onlyBad && (
        <div className="mx-5 mt-3 bg-blue-50 border border-blue-200 rounded-md px-3 py-2 text-xs text-blue-700 flex items-center gap-2">
          <span className="text-base">✅</span>
          <span>
            이 마을의 모든 시설이 <b>여유 상태</b>입니다. 총{" "}
            <b>{rows.length}건</b>.
          </span>
        </div>
      )}

      {/* 그룹 리스트 — min-h-0 로 flex 자식 overflow 경계 잡아줌 */}
      <div className="overflow-auto flex-1 min-h-0 px-5 py-3 space-y-3">
        {visibleGroups.length === 0 ? (
          <div className="text-center text-xs text-gray-400 py-10">
            조건에 맞는 결과가 없어요
          </div>
        ) : (
          visibleGroups.map((g) => (
            <GroupBlock
              key={g.key}
              group={g}
              // compact = 항상 펼침 + 그룹 헤더 통째로 숨김
              collapsed={compact ? false : !expandedKeys.has(g.key)}
              onToggle={compact ? () => {} : () => toggleGroup(g.key)}
              onJibunPin={onJibunPin}
              hideHeader={compact}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** 그룹 1개 — 헤더(시설 요약) + 지번 리스트 */
function GroupBlock({
  group,
  collapsed,
  onToggle,
  onJibunPin,
  hideHeader = false,
}: {
  group: FacilityGroup;
  collapsed: boolean;
  onToggle: () => void;
  onJibunPin?: (row: KepcoDataRow) => void;
  /** compact 모드 — 그룹 헤더(시설 요약 + 토글) 통째로 숨기고 칼럼+행만 표시 */
  hideHeader?: boolean;
}) {
  const { substNm, mtrNo, dlNm, rows, noCap, status } = group;
  const total = rows.length;

  const statusBadge =
    status === "ok" ? (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
        전부 여유
      </span>
    ) : status === "bad" ? (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
        전부 부족
      </span>
    ) : (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
        일부 부족
      </span>
    );

  return (
    <div
      className={
        hideHeader
          ? "" // compact: 외곽 테두리/배경 제거 — 칼럼+행만 깔끔히
          : `border rounded-lg overflow-hidden ${
              status === "bad"
                ? "border-red-200"
                : status === "partial"
                  ? "border-amber-200"
                  : "border-gray-200"
            }`
      }
    >
      {/* 그룹 헤더 — compact 에서는 통째로 숨김 */}
      {!hideHeader && (
        <button
          type="button"
          onClick={onToggle}
          className={`w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors ${
            status === "bad"
              ? "bg-red-50 hover:bg-red-100"
              : status === "partial"
                ? "bg-amber-50 hover:bg-amber-100"
                : "bg-gray-50 hover:bg-gray-100"
          }`}
        >
          <span
            className={`text-gray-500 transition-transform ${
              collapsed ? "" : "rotate-90"
            }`}
          >
            ▶
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-xs md:text-sm text-gray-900 flex items-center gap-1.5 md:gap-2 flex-wrap">
              <span><span className="text-gray-500 font-medium">변전소</span> <span className="font-bold text-blue-700">{substNm}</span></span>
              <span className="text-gray-300">·</span>
              <span><span className="text-gray-500 font-medium">주변압기</span> <span className="font-bold text-emerald-700">#{mtrNo}</span></span>
              <span className="text-gray-300">·</span>
              <span><span className="text-gray-500 font-medium">배전선로</span> <span className="font-bold text-amber-700">{dlNm}</span></span>
            </div>
            <div className="text-[11px] text-gray-600 mt-0.5 flex items-center gap-1 flex-wrap">
              <span>{total.toLocaleString()}건</span>
              {status !== "ok" && (
                <>
                  <span className="text-gray-300">·</span>
                  {noCap.subst > 0 && (
                    <span className="text-red-600">변전소 <span className="font-semibold">{noCap.subst}</span></span>
                  )}
                  {noCap.mtr > 0 && (
                    <span className="text-red-600">주변압기 <span className="font-semibold">{noCap.mtr}</span></span>
                  )}
                  {noCap.dl > 0 && (
                    <span className="text-red-600">선로 <span className="font-semibold">{noCap.dl}</span></span>
                  )}
                  <span className="text-red-500 text-[10px]">부족</span>
                </>
              )}
            </div>
          </div>
          {statusBadge}
        </button>
      )}

      {/* 그룹 본문 — 컬럼 헤더 + 지번 목록. compact 면 항상 펼침 */}
      {!collapsed && (
        <div className="bg-white">
          {/* 컬럼 헤더 */}
          <div className="flex items-center gap-3 px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-500">
            <span className="w-3"></span>
            <span className="min-w-[60px]">번지</span>
            <div className="flex-1 grid grid-cols-3 gap-2">
              <span className="text-blue-600">🏭 변전소</span>
              <span className="text-emerald-600">⚡ 주변압기</span>
              <span className="text-amber-600">📡 배전선로</span>
            </div>
          </div>
          <ul className="divide-y divide-gray-100">
            {rows.map((r) => (
              <JibunRow key={r.id} row={r} onJibunPin={onJibunPin} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 지번 1줄 — 번지 + 시설별 잔여 용량 숫자, 클릭 시 상세 펼침 */
function JibunRow({ row, onJibunPin }: { row: KepcoDataRow; onJibunPin?: (row: KepcoDataRow) => void }) {
  const [open, setOpen] = useState(false);

  const substRemain = (row.subst_capa ?? 0) - (row.subst_pwr ?? 0);
  const mtrRemain = (row.mtr_capa ?? 0) - (row.mtr_pwr ?? 0);
  const dlRemain = (row.dl_capa ?? 0) - (row.dl_pwr ?? 0);
  const substOk = hasCapacity(row.subst_capa, row.subst_pwr, row.g_subst_capa);
  const mtrOk = hasCapacity(row.mtr_capa, row.mtr_pwr, row.g_mtr_capa);
  const dlOk = hasCapacity(row.dl_capa, row.dl_pwr, row.g_dl_capa);

  return (
    <>
      <li>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-blue-50/40 ${
            open ? "bg-blue-50/60" : ""
          }`}
        >
          <span
            className={`text-gray-400 transition-transform ${
              open ? "rotate-90 text-blue-600" : ""
            } text-[10px]`}
          >
            ▶
          </span>
          <span className="text-xs font-semibold min-w-[60px]">
            {onJibunPin && row.addr_jibun ? (
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onJibunPin(row);
                }}
                className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                title="지도에서 이 지번 위치 보기"
              >
                📍 {row.addr_jibun}
              </span>
            ) : (
              <span className="text-gray-900">{row.addr_jibun || "-"}</span>
            )}
          </span>
          {/* 시설별 여유 상태 — KEPCO 수식 계산 */}
          <div className="flex-1 grid grid-cols-3 gap-2 text-[11px]">
            <CapLabel ok={hasCapacity(row.subst_capa, row.subst_pwr, row.g_subst_capa)} />
            <CapLabel ok={hasCapacity(row.mtr_capa, row.mtr_pwr, row.g_mtr_capa)} />
            <CapLabel ok={hasCapacity(row.dl_capa, row.dl_pwr, row.g_dl_capa)} />
          </div>
        </button>
      </li>
      {open && (
        <li className="bg-blue-50/30 border-y border-blue-100 px-4 py-3">
          <div className="grid grid-cols-3 gap-2">
            <FacilityCard
              title="변전소"
              name={row.subst_nm ?? "-"}
              ok={substOk}
              base={row.subst_capa}
              received={row.subst_pwr}
              planned={row.g_subst_capa}
            />
            <FacilityCard
              title="주변압기"
              name={`#${row.mtr_no ?? "-"}`}
              ok={mtrOk}
              base={row.mtr_capa}
              received={row.mtr_pwr}
              planned={row.g_mtr_capa}
            />
            <FacilityCard
              title="배전선로"
              name={row.dl_nm ?? "-"}
              ok={dlOk}
              base={row.dl_capa}
              received={row.dl_pwr}
              planned={row.g_dl_capa}
            />
          </div>
          {(row.step1_cnt != null ||
            row.step2_cnt != null ||
            row.step3_cnt != null) && (
            <div className="bg-white border border-gray-200 rounded-md p-2.5 mt-2">
              <div className="text-[11px] font-bold text-gray-700 mb-1.5">
                📋 접속 예정 단계
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <StepBlock label="접수" cnt={row.step1_cnt} pwr={row.step1_pwr} />
                <StepBlock
                  label="공용망 보강"
                  cnt={row.step2_cnt}
                  pwr={row.step2_pwr}
                />
                <StepBlock label="접속 공사" cnt={row.step3_cnt} pwr={row.step3_pwr} />
              </div>
            </div>
          )}
        </li>
      )}
    </>
  );
}

/**
 * 인라인 잔여 표시 — 시설 라벨 + 부호 색상 숫자.
 * 그룹 뷰의 지번 행에서 좁은 폭에 맞게 컴팩트하게 표현.
 */
function RemainInline({
  label,
  remaining,
}: {
  label: string;
  remaining: number;
}) {
  const color =
    remaining > 0
      ? "text-blue-600"
      : remaining < 0
        ? "text-red-600"
        : "text-gray-400";
  return (
    <span className="inline-flex items-center gap-1 min-w-0 truncate">
      <span className="hidden md:inline text-gray-400 flex-shrink-0">{label}</span>
      <span className={`font-semibold tabular-nums ${color}`}>
        {formatRemaining(remaining)}
      </span>
    </span>
  );
}

/** 여유/없음 배지 — KEPCO 수식 기반 */
function CapLabel({ ok }: { ok: boolean }) {
  return (
    <span className={`text-[11px] font-semibold ${ok ? "text-blue-600" : "text-red-600"}`}>
      {ok ? "여유" : "없음"}
    </span>
  );
}
