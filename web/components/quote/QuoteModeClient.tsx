"use client";

/* eslint-disable react-hooks/set-state-in-effect --
 * fetch 시작 시 loading=true 로 외부 비동기 상태와 동기화 — 의도된 effect.
 */

/**
 * 견적 모드 풀스크린 클라이언트 — /quote/[pnu] 라우트 본체.
 *
 * 1차 푸시 범위 (이번):
 *   - PNU 받아 필지 + 건물 폴리곤 atomic endpoint 호출
 *   - 풀스크린 3-pane 레이아웃 (좌 도구 / 중앙 지도 / 우 결과)
 *   - 1섹션(영역 정의) — 건물 N동/합계 면적 자동 표시 (선택 X, 표시만)
 *   - 2~5섹션(시설견적/패널/PDF/수지분석) placeholder
 *
 * 다음 푸시:
 *   - 영역 클릭 선택 + 다중 선택
 *   - 시설 종류 자동 추천 + 변경
 *   - 면적 → kW → 시공비 산출
 *   - 수지분석/PDF
 *
 * 모바일: 폰(<768) 은 읽기 전용 안내. 태블릿(768~) 부터 풀 기능.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchVworldParcelByPnu } from "@/lib/api/vworld";
import {
  fetchBuildingPolygonsByPnu,
  fetchBuildingsByPnu,
  type BuildingTitleInfo,
} from "@/lib/api/buildings";
import { fetchKepcoCapaByJibun } from "@/lib/api/kepco";
import type { JibunInfo, ParcelGeometry } from "@/lib/vworld/parcel";
import type { BuildingPolygon } from "@/lib/vworld/buildings";
import type { AddrMeta, KepcoDataRow } from "@/lib/types";
import type { Position } from "geojson";
import ParcelInfoPanel from "@/components/map/ParcelInfoPanel";
import QuoteMap, { type EditableBuilding } from "./QuoteMap";

const M2_TO_PYEONG = 0.3025;

/**
 * 편집 상태가 추가된 건물 — VWorld 원본 + 사용자 수정 폴리곤/면적.
 * 원본은 변경 안 함 → "원래대로" 복원 가능 (다음 푸시에서 UI 추가).
 */
interface EditedBuilding extends BuildingPolygon {
  edited_polygon: Position[][];
  edited_area_m2: number;
  is_edited: boolean;
}

function toEdited(b: BuildingPolygon): EditedBuilding {
  return {
    ...b,
    edited_polygon: b.polygon,
    edited_area_m2: b.area_m2,
    is_edited: false,
  };
}

/** QuoteMap 에 넘길 안정적 식별자 — VWorld pk 우선, 없으면 bd_mgt_sn */
function makeBuildingId(b: BuildingPolygon): string {
  return b.pk || b.bd_mgt_sn || `${b.pnu}-${b.buld_no}`;
}

interface Props {
  pnu: string;
}

export default function QuoteModeClient({ pnu }: Props) {
  const [jibun, setJibun] = useState<JibunInfo | null>(null);
  const [geometry, setGeometry] = useState<ParcelGeometry | null>(null);
  const [buildings, setBuildings] = useState<EditedBuilding[]>([]);
  // 건축물대장 표제부 — 도로명주소건물(폴리곤) 과는 별개 데이터셋.
  // 동·식물관련시설은 대장 등록은 되지만 도로명주소 미부여로 폴리곤 0건 케이스가 흔함.
  const [bldgRegister, setBldgRegister] = useState<BuildingTitleInfo[]>([]);
  // 부지 정보 floating overlay 용 — 메인 지도와 동일 ParcelInfoPanel
  const [capa, setCapa] = useState<KepcoDataRow[]>([]);
  const [meta, setMeta] = useState<AddrMeta | null>(null);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [loadingParcel, setLoadingParcel] = useState(true);
  const [loadingBuildings, setLoadingBuildings] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 데이터 fetch — 세 endpoint 병렬 (필지 + 건물 폴리곤 + 건축물대장)
  useEffect(() => {
    const ctl = new AbortController();
    setLoadingParcel(true);
    setLoadingBuildings(true);
    setError(null);

    fetchVworldParcelByPnu(pnu, { signal: ctl.signal })
      .then((res) => {
        if (!res) {
          setError("필지 정보를 찾을 수 없습니다.");
          return;
        }
        setJibun(res.jibun);
        setGeometry(res.geometry);
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "필지 조회 실패");
      })
      .finally(() => setLoadingParcel(false));

    fetchBuildingPolygonsByPnu(pnu, { signal: ctl.signal })
      .then((rows) => setBuildings(rows.map(toEdited)))
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        // 건물 0건은 정상 (가설건축물 등) — 에러로 막지 않고 빈배열 유지
        console.error("건물 폴리곤 조회 실패:", e);
      })
      .finally(() => setLoadingBuildings(false));

    fetchBuildingsByPnu(pnu, { signal: ctl.signal })
      .then(setBldgRegister)
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        console.error("건축물대장 조회 실패:", e);
      });

    return () => ctl.abort();
  }, [pnu]);

  // jibun 받은 후 KEPCO 용량 + meta 별도 fetch (ParcelInfoPanel 의 전기 탭 + 헤더 주소용)
  useEffect(() => {
    if (!jibun) return;
    const bjdCode = jibun.pnu.slice(0, 10);
    const jibunStr = jibun.jibun;
    if (!/^\d{10}$/.test(bjdCode) || !jibunStr) return;
    const ctl = new AbortController();
    fetchKepcoCapaByJibun(bjdCode, jibunStr, { signal: ctl.signal })
      .then((res) => {
        setCapa(res.rows);
        setMeta(res.meta);
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        console.error("KEPCO 용량 조회 실패:", e);
      });
    return () => ctl.abort();
  }, [jibun]);

  /** QuoteMap 의 dragend → 해당 동만 폴리곤/면적 갱신 */
  const handleBuildingChange = useCallback(
    (id: string, newPolygon: Position[][], newAreaM2: number) => {
      setBuildings((prev) =>
        prev.map((b) =>
          makeBuildingId(b) === id
            ? {
                ...b,
                edited_polygon: newPolygon,
                edited_area_m2: newAreaM2,
                is_edited: true,
              }
            : b,
        ),
      );
    },
    [],
  );

  /** QuoteMap props 형태로 변환 — 편집된 polygon/area 사용 */
  const editableBuildings: EditableBuilding[] = useMemo(
    () =>
      buildings.map((b) => ({
        id: makeBuildingId(b),
        polygon: b.edited_polygon,
        area_m2: b.edited_area_m2,
      })),
    [buildings],
  );

  const buildingArea = buildings.reduce(
    (sum, b) => sum + b.edited_area_m2,
    0,
  );
  const buildingPyeong = Math.round(buildingArea * M2_TO_PYEONG);
  const editedCount = buildings.filter((b) => b.is_edited).length;
  const parcelPyeong = geometry
    ? Math.round(geometry.area_m2 * M2_TO_PYEONG)
    : null;

  const headerAddr = jibun
    ? [jibun.ctp_nm, jibun.sig_nm, jibun.emd_nm, jibun.li_nm, jibun.jibun]
        .filter(Boolean)
        .join(" ")
    : "필지 정보 불러오는 중…";

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-100">
      {/* 상단바 */}
      <header className="flex items-center justify-between gap-3 h-12 px-3 md:px-4 bg-white border-b border-gray-200 shrink-0">
        <Link
          href="/"
          className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded"
        >
          <span className="text-base">←</span>
          <span className="hidden md:inline">지도로</span>
        </Link>
        <button
          onClick={() => setIsInfoOpen((v) => !v)}
          className={`px-2.5 py-1.5 text-sm rounded transition-colors ${
            isInfoOpen
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
          title="이 부지의 필지/전기/가격/입지/규제 정보"
        >
          ⓘ <span className="hidden md:inline ml-0.5">부지 정보</span>
        </button>
        <div className="flex-1 min-w-0 text-center">
          <div className="text-sm md:text-base font-bold text-gray-900 truncate">
            {headerAddr}
          </div>
          <div className="text-[10px] text-gray-400 font-mono truncate">
            PNU {pnu}
          </div>
        </div>
        <button
          disabled
          className="px-3 py-1.5 text-sm bg-gray-200 text-gray-400 rounded cursor-not-allowed"
          title="4단계 작업 예정"
        >
          PDF 출력
        </button>
      </header>

      {/* 부지 정보 floating overlay — 메인 지도 ParcelInfoPanel 그대로 재사용.
          [ⓘ 부지 정보] 버튼으로 토글. 데이터는 위 useEffect 들이 atomic endpoint
          호출 (HTTP 캐시 hit 으로 사실상 0 fetch) → props 로 전달. */}
      {isInfoOpen && (
        <ParcelInfoPanel
          jibun={jibun}
          geometry={geometry}
          capa={capa}
          meta={meta}
          clickedJibun={jibun?.jibun ?? ""}
          matchMode={jibun ? "exact" : null}
          nearestJibun={null}
          loading={loadingParcel}
          onClose={() => setIsInfoOpen(false)}
          polygonCount={loadingBuildings ? undefined : buildings.length}
          inQuoteMode
        />
      )}

      {/* 폰 안내 — 태블릿 이상에선 숨김 */}
      <div className="md:hidden flex-1 flex items-center justify-center px-6 text-center bg-white">
        <div>
          <div className="text-3xl mb-3">📐</div>
          <div className="text-sm font-semibold text-gray-900 mb-1">
            견적 모드는 태블릿/PC에서 작업하세요
          </div>
          <div className="text-xs text-gray-500 leading-relaxed">
            영역 그리기 / 시설 변경 / 패널 배치 등 정밀 작업 화면입니다.
            <br />
            폰에서는 결과만 확인 가능 (다음 단계 작업 예정).
          </div>
        </div>
      </div>

      {/* 본문 (태블릿+) */}
      <div className="hidden md:flex flex-1 min-h-0 overflow-hidden">
        {/* 좌측 도구 패널 — 영역 정의/시설/PDF/수지 (작업 도구 전용).
            부지 정보(필지/전기/가격/입지/규제) 는 상단바 [ⓘ] 토글로 별도 표시. */}
        <aside className="w-72 lg:w-80 bg-white border-r border-gray-200 overflow-y-auto">
          <SectionHeader step={1} title="영역 정의" status="active" />
          <div className="px-4 py-3 space-y-2 text-sm">
            {loadingBuildings ? (
              <div className="text-gray-500">건물 폴리곤 불러오는 중…</div>
            ) : (
              <>
                <Row label="건물 동수" value={`${buildings.length}동`} />
                <Row
                  label="건물 합계"
                  value={
                    buildings.length === 0
                      ? "—"
                      : `${buildingArea.toLocaleString()}㎡ (${buildingPyeong.toLocaleString()}평)`
                  }
                />
                {buildings.length === 0 && bldgRegister.length === 0 && (
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 leading-snug">
                    자동 감지된 건물도, 등록된 건축물대장도 없습니다.
                    <br />
                    노지/빈 토지 부지로 보입니다 — 다음 단계 [+ 영역 추가]
                    로 패널 깔 영역을 잡습니다.
                  </div>
                )}
                {buildings.length === 0 && bldgRegister.length > 0 && (
                  <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-300 rounded px-2 py-1.5 leading-snug">
                    ⚠️ 건축물대장에 <b>{bldgRegister.length}동</b> 등록되어 있지만
                    도로명주소가 미부여되어 자동 폴리곤 데이터가 없습니다.
                    <br />
                    위성 사진을 보고 다음 단계 [+ 영역 추가] 로 직접 그려주세요.
                  </div>
                )}
                {buildings.length > 0 && (
                  <div className="text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1.5 leading-snug">
                    💡 폴리곤 모서리의 흰 점을 드래그해 옥상 영역을 정밀하게
                    수정할 수 있습니다.
                    {editedCount > 0 && (
                      <span className="block mt-0.5 text-blue-900 font-semibold">
                        수정됨 {editedCount}동
                      </span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <SectionHeader step={2} title="시설별 견적" status="pending" />
          <div className="px-4 py-3 text-xs text-gray-400">
            영역 선택 후 자동 산출 (다음 푸시)
          </div>
          <SectionHeader step={3} title="패널 시각화" status="pending" />
          <div className="px-4 py-3 text-xs text-gray-400">3단계 작업 예정</div>
          <SectionHeader step={4} title="배치도 PDF" status="pending" />
          <div className="px-4 py-3 text-xs text-gray-400">4단계 작업 예정</div>
          <SectionHeader step={5} title="수지분석" status="pending" />
          <div className="px-4 py-3 text-xs text-gray-400">5단계 작업 예정</div>
        </aside>

        {/* 중앙 지도 */}
        <main className="flex-1 min-w-0 relative bg-gray-200">
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-white border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            </div>
          ) : (
            <QuoteMap
              parcelPolygon={geometry?.polygon ?? null}
              buildings={editableBuildings}
              onBuildingChange={handleBuildingChange}
              fallbackCenter={geometry?.center}
            />
          )}
          {(loadingParcel || loadingBuildings) && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-white/95 border border-gray-300 rounded-full px-3 py-1 text-xs text-gray-700 shadow">
              불러오는 중…
            </div>
          )}
        </main>

        {/* 우측 결과 패널 */}
        <aside className="w-80 lg:w-96 bg-white border-l border-gray-200 overflow-y-auto">
          <div className="px-4 py-3 border-b border-gray-200">
            <div className="text-[11px] text-gray-500 font-semibold">
              필지 면적
            </div>
            <div className="text-2xl font-bold text-gray-900 tabular-nums">
              {parcelPyeong != null
                ? `${parcelPyeong.toLocaleString()}평`
                : "—"}
            </div>
            <div className="text-[11px] text-gray-400 tabular-nums">
              {geometry ? `${geometry.area_m2.toLocaleString()}㎡` : ""}
              {geometry?.jimok ? ` · ${geometry.jimok}` : ""}
            </div>
          </div>
          <div className="px-4 py-3 border-b border-gray-200">
            <div className="text-[11px] text-emerald-700 font-semibold">
              건물 옥상 (자동 감지)
            </div>
            <div className="text-2xl font-bold text-gray-900 tabular-nums">
              {loadingBuildings
                ? "…"
                : buildings.length === 0
                  ? "0평"
                  : `${buildingPyeong.toLocaleString()}평`}
            </div>
            <div className="text-[11px] text-gray-400 tabular-nums">
              {loadingBuildings
                ? ""
                : `${buildings.length}동 · ${buildingArea.toLocaleString()}㎡`}
            </div>
          </div>
          {buildings.length > 0 && (
            <div className="px-4 py-3">
              <div className="text-[11px] text-gray-500 font-semibold mb-2">
                동별 상세
              </div>
              <ul className="space-y-1.5 text-xs">
                {buildings.map((b, i) => {
                  const py = Math.round(b.edited_area_m2 * M2_TO_PYEONG);
                  const origPy = Math.round(b.area_m2 * M2_TO_PYEONG);
                  return (
                    <li
                      key={b.pk || i}
                      className={`flex items-center justify-between gap-2 px-2 py-1.5 border rounded ${
                        b.is_edited
                          ? "bg-blue-50/80 border-blue-200"
                          : "bg-orange-50/60 border-orange-100"
                      }`}
                    >
                      <span className="text-gray-700 truncate">
                        {b.buld_nm || `${i + 1}동`}
                        <span className="text-gray-400 ml-1">
                          {b.gro_flo_co}F
                        </span>
                        {b.is_edited && (
                          <span className="ml-1 text-[10px] text-blue-700 font-semibold">
                            수정
                          </span>
                        )}
                      </span>
                      <span className="font-semibold tabular-nums shrink-0">
                        {py.toLocaleString()}평
                        {b.is_edited && (
                          <span className="text-gray-400 font-normal ml-1 line-through">
                            {origPy.toLocaleString()}평
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="px-4 py-3 border-t border-gray-200">
            <div className="text-[11px] text-gray-400 leading-relaxed">
              💡 옥상 영역 미세 조정 단계. 폴리곤 모서리의 흰 점을 드래그하면
              면적·평수가 즉시 갱신됩니다. 다음 단계에서 시설 종류 자동 추천 +
              kW/시공비 카드가 채워집니다.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 보조 컴포넌트
// ─────────────────────────────────────────────

function SectionHeader({
  step,
  title,
  status,
}: {
  step: number;
  title: string;
  status: "active" | "pending";
}) {
  const isActive = status === "active";
  return (
    <div
      className={`flex items-center gap-2 px-4 py-2 border-b border-gray-200 ${
        isActive ? "bg-blue-50" : "bg-gray-50"
      }`}
    >
      <span
        className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
          isActive
            ? "bg-blue-600 text-white"
            : "bg-gray-200 text-gray-500"
        }`}
      >
        {step}
      </span>
      <span
        className={`text-xs font-semibold ${
          isActive ? "text-blue-900" : "text-gray-500"
        }`}
      >
        {title}
      </span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-500 text-xs">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

