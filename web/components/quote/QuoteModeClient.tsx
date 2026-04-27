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
import {
  createDefaultRect,
  calcAreaM2,
  polygonCenter,
  addVertex,
  removeVertex,
  findLongestEdge,
  findFlattestVertex,
} from "@/lib/geometry/polygon-edit";
import {
  FACILITY_KINDS,
  FACILITY_LABEL,
  FACILITY_SPEC,
  calcCost,
  calcKw,
  formatCost,
  formatKw,
  recommendFacility,
  type FacilityKind,
  type FacilitySpec,
} from "@/lib/quote/facility";
import {
  DEFAULT_MODULE,
  FACILITY_PLACEMENT,
  calcInstalledKw,
  type PanelModule,
} from "@/lib/quote/panel";
import {
  fillPanelGrid,
  calcAutoRotation,
  calcAreaDimensions,
} from "@/lib/quote/grid";
import ParcelInfoPanel from "@/components/map/ParcelInfoPanel";
import QuoteMap, { type EditableBuilding } from "./QuoteMap";

const M2_TO_PYEONG = 0.3025;

/**
 * 편집 상태가 추가된 건물 — VWorld 원본 + 사용자 수정 폴리곤/면적.
 * source = "vworld" 자동 감지 / "user_added" 사용자가 [+ 영역 추가] 로 만든 것.
 * 원본은 변경 안 함 → "원래대로" 복원 가능 (다음 푸시에서 UI 추가).
 */
interface EditedBuilding extends BuildingPolygon {
  edited_polygon: Position[][];
  edited_area_m2: number;
  is_edited: boolean;
  source: "vworld" | "user_added";
  /** 사용자 추가 동의 안정적 ID (pk 가 비어있으니 별도 부여) */
  local_id?: string;
}

function toEdited(b: BuildingPolygon): EditedBuilding {
  return {
    ...b,
    edited_polygon: b.polygon,
    edited_area_m2: b.area_m2,
    is_edited: false,
    source: "vworld",
  };
}

/** QuoteMap 에 넘길 안정적 식별자 — VWorld pk 우선, 사용자 추가는 local_id */
function makeBuildingId(b: EditedBuilding): string {
  if (b.source === "user_added" && b.local_id) return b.local_id;
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

  /**
   * [+ 영역 추가] — 부지 중심에 기본 15m × 15m 사각형 생성.
   * 사용자가 꼭지점 드래그로 위치/크기 조정.
   */
  const handleAddBuilding = useCallback(() => {
    if (!geometry) return; // 부지 없으면 추가 불가 (현재로선 발생 X)
    // 부지 폴리곤 centroid 를 기본 위치로 — 폴리곤 안에 등장
    const center = polygonCenter(geometry.polygon) ?? geometry.center;
    const polygon = createDefaultRect(center, 15);
    const area_m2 = calcAreaM2(polygon);

    setBuildings((prev) => {
      // 사용자추가 라벨용 카운터 — 기존 user_added 동수 + 1
      const userCount = prev.filter((b) => b.source === "user_added").length + 1;
      const local_id = `user_${Date.now()}_${userCount}`;
      const newBuilding: EditedBuilding = {
        // VWorld 필드는 빈 문자열/0 으로 채움
        pk: "",
        bd_mgt_sn: "",
        pnu,
        sido: "",
        sigungu: "",
        gu: "",
        rd_nm: "",
        buld_no: "",
        gro_flo_co: 1,
        und_flo_co: 0,
        buld_nm: `사용자추가 ${userCount}`,
        polygon,
        area_m2,
        center,
        // 편집 상태
        edited_polygon: polygon,
        edited_area_m2: area_m2,
        is_edited: false,
        source: "user_added",
        local_id,
      };
      return [...prev, newBuilding];
    });
  }, [geometry, pnu]);

  /** 동 삭제 — 우측 카드 🗑 클릭 → 빨간 모드 → [정말 삭제] 시 호출 */
  const handleDeleteBuilding = useCallback((id: string) => {
    setBuildings((prev) => prev.filter((b) => makeBuildingId(b) !== id));
  }, []);

  /**
   * 우측 카드 [+] 클릭 → 가장 긴 변 가운데에 새 꼭지점 자동 삽입.
   * 사용자는 추가된 점을 드래그로 원하는 위치로 이동.
   */
  const handleAutoAddVertex = useCallback((id: string) => {
    setBuildings((prev) =>
      prev.map((b) => {
        if (makeBuildingId(b) !== id) return b;
        const longest = findLongestEdge(b.edited_polygon);
        if (!longest) return b;
        const newPolygon = addVertex(
          b.edited_polygon,
          longest.ringIdx,
          longest.edgeIdx,
          longest.midpoint,
        );
        return {
          ...b,
          edited_polygon: newPolygon,
          edited_area_m2: calcAreaM2(newPolygon),
          is_edited: true,
        };
      }),
    );
  }, []);

  /**
   * 우측 카드 [−] 클릭 → 각도 가장 평평한 점(거의 직선상) 자동 삭제.
   * 모양 거의 안 바뀜. 최소 3점은 findFlattestVertex 가 자체 검증 (null 반환).
   */
  const handleAutoRemoveVertex = useCallback((id: string) => {
    setBuildings((prev) =>
      prev.map((b) => {
        if (makeBuildingId(b) !== id) return b;
        const flat = findFlattestVertex(b.edited_polygon);
        if (!flat) return b; // 3점 이하면 거부
        const newPolygon = removeVertex(
          b.edited_polygon,
          flat.ringIdx,
          flat.vertexIdx,
        );
        if (newPolygon === b.edited_polygon) return b;
        return {
          ...b,
          edited_polygon: newPolygon,
          edited_area_m2: calcAreaM2(newPolygon),
          is_edited: true,
        };
      }),
    );
  }, []);

  /** 꼭지점 마커 dblclick → 점 삭제. 최소 3점은 removeVertex 가 자체 검증. */
  const handleRemoveVertex = useCallback(
    (id: string, ringIdx: number, vertexIdx: number) => {
      setBuildings((prev) =>
        prev.map((b) => {
          if (makeBuildingId(b) !== id) return b;
          const newPolygon = removeVertex(b.edited_polygon, ringIdx, vertexIdx);
          if (newPolygon === b.edited_polygon) return b; // 거부됨 (3점 미만 방어)
          return {
            ...b,
            edited_polygon: newPolygon,
            edited_area_m2: calcAreaM2(newPolygon),
            is_edited: true,
          };
        }),
      );
    },
    [],
  );

  /** 우측 카드의 🗑 클릭 시 빨간 모드 진입 — id 일치하면 [정말 삭제] / [취소] 표시 */
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null);

  // ── 2섹션 시설별 견적 — 사용자 변경 사항만 별도 state. 자동 추천은 derive.
  /** 동별 시설 종류 사용자 선택. 미설정이면 recommendFacility() 결과 사용. */
  const [facilityOverrides, setFacilityOverrides] = useState<
    Record<string, FacilityKind>
  >({});
  /** 동별 단가 사용자 변경. 미설정이면 FACILITY_SPEC[kind] 디폴트 사용.
   *  시설 종류가 바뀌면 자동 클리어 (새 시설의 디폴트 단가로 복귀). */
  const [specOverrides, setSpecOverrides] = useState<
    Record<string, FacilitySpec>
  >({});
  /** 단가 인라인 편집 펼친 동의 id (한 번에 한 동만 편집) */
  const [editingSpecId, setEditingSpecId] = useState<string | null>(null);

  // ── 3단계 — 패널 모듈 사용자 변경 (의뢰자 추가 요청 2026-04-27)
  /** 사용자가 변경한 모듈. null 이면 DEFAULT_MODULE (AIKO 670W) 사용 */
  const [customModule, setCustomModule] = useState<PanelModule | null>(null);
  const [isEditingModule, setIsEditingModule] = useState(false);
  const activeModule = customModule ?? DEFAULT_MODULE;
  const isCustomModule = customModule !== null;

  // ── 좌측 패널 아코디언 — 활성 1개 step 만 펼침 (기본 1: 영역 정의).
  // 활성 헤더 다시 클릭하면 null (모두 접힘).
  const [activeStep, setActiveStep] = useState<number | null>(1);
  const toggleStep = useCallback((step: number) => {
    setActiveStep((prev) => (prev === step ? null : step));
  }, []);

  // ── 동 선택 강조 — 라벨/폴리곤 클릭 시 set, 좌측 카드도 동시 강조
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(
    null,
  );
  const handleSelectBuilding = useCallback((id: string) => {
    setSelectedBuildingId((prev) => (prev === id ? null : id));
  }, []);
  const handleRequestDelete = useCallback((id: string) => {
    setDeletePendingId(id);
  }, []);

  const handleFacilityChange = useCallback(
    (id: string, kind: FacilityKind) => {
      setFacilityOverrides((prev) => ({ ...prev, [id]: kind }));
      // 시설 종류 변경 → 단가 override 클리어 (새 시설 디폴트 적용)
      setSpecOverrides((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [],
  );

  const handleSpecChange = useCallback((id: string, spec: FacilitySpec) => {
    setSpecOverrides((prev) => ({ ...prev, [id]: spec }));
  }, []);

  const handleResetSpec = useCallback((id: string) => {
    setSpecOverrides((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const handleResetFacility = useCallback((id: string) => {
    setFacilityOverrides((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  /** QuoteMap props 형태로 변환 — 편집된 polygon/area + 우측 카드와 동일한 동 이름 + 3단계 패널 격자 */
  const editableBuildings: EditableBuilding[] = useMemo(
    () =>
      buildings.map((b, i) => {
        const id = makeBuildingId(b);
        const facility =
          facilityOverrides[id] ??
          recommendFacility(
            b.source,
            geometry?.jimok ?? "",
            bldgRegister,
          );
        const placement = FACILITY_PLACEMENT[facility];
        // Step 3-2: 시설별 자동 회전 (정남 / 건물 가장 긴 변 평행)
        const rotation = calcAutoRotation(b.edited_polygon, placement.rotation);
        const layout = fillPanelGrid(
          b.edited_polygon,
          activeModule,
          placement,
          rotation,
        );
        // Step 3-5: 회전된 bbox 가로 × 세로 (m) — 영역 라벨 표시용
        const dims = calcAreaDimensions(b.edited_polygon, rotation);
        return {
          id,
          name: b.buld_nm || `${i + 1}동`,
          polygon: b.edited_polygon,
          area_m2: b.edited_area_m2,
          panels: layout.panels,
          widthM: dims.widthM,
          heightM: dims.heightM,
        };
      }),
    [buildings, facilityOverrides, geometry, bldgRegister, activeModule],
  );

  /** 3단계 동별 패널 카드용 — id → (count, kw) 매핑 */
  const panelLayouts = useMemo(() => {
    return editableBuildings.map((eb) => ({
      id: eb.id,
      name: eb.name,
      count: eb.panels?.length ?? 0,
      kwActual: calcInstalledKw(eb.panels?.length ?? 0, activeModule),
    }));
  }, [editableBuildings, activeModule]);

  const totalPanels = panelLayouts.reduce((s, l) => s + l.count, 0);
  const totalKwActual = panelLayouts.reduce((s, l) => s + l.kwActual, 0);

  // ESC 키 → 삭제 확인 모달 닫기
  useEffect(() => {
    if (!deletePendingId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDeletePendingId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deletePendingId]);

  /** 삭제 확인 모달용 — 현재 삭제 대기 동 정보 */
  const pendingDeleteBuilding = useMemo(() => {
    if (!deletePendingId) return null;
    const b = buildings.find((x) => makeBuildingId(x) === deletePendingId);
    if (!b) return null;
    const idx = buildings.indexOf(b);
    return {
      id: deletePendingId,
      name: b.buld_nm || `${idx + 1}동`,
      pyeong: Math.round(b.edited_area_m2 * M2_TO_PYEONG),
    };
  }, [deletePendingId, buildings]);

  /** 동별 시설 종류 + 단가 + kW + 시공비 한 번에 계산 (자동 추천 포함) */
  const facilityRows = useMemo(() => {
    const jimok = geometry?.jimok ?? "";
    return buildings.map((b) => {
      const id = makeBuildingId(b);
      const auto = recommendFacility(b.source, jimok, bldgRegister);
      const kind = facilityOverrides[id] ?? auto;
      const spec = specOverrides[id] ?? FACILITY_SPEC[kind];
      const py = b.edited_area_m2 * M2_TO_PYEONG;
      const kw = calcKw(py, spec);
      const cost = calcCost(kw, spec);
      return {
        id,
        building: b,
        auto,
        kind,
        spec,
        py,
        kw,
        cost,
        isAutoKind: !facilityOverrides[id],
        isCustomSpec: !!specOverrides[id],
      };
    });
  }, [buildings, geometry, bldgRegister, facilityOverrides, specOverrides]);

  const totalKw = facilityRows.reduce((s, r) => s + r.kw, 0);
  const totalCost = facilityRows.reduce((s, r) => s + r.cost, 0);

  const buildingArea = buildings.reduce(
    (sum, b) => sum + b.edited_area_m2,
    0,
  );
  const buildingPyeong = Math.round(buildingArea * M2_TO_PYEONG);
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
      {/* 상단바 — 견적 모드는 새 탭으로 진입하므로 [지도로] 버튼 없음 (탭 닫기로 종료) */}
      <header className="flex items-center justify-between gap-3 h-12 px-3 md:px-4 bg-white border-b border-gray-200 shrink-0">
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
        {/* 좌측 도구 패널 — 모든 견적 작업 (영역/시설/패널/PDF/수지) + 합계 + 부지정보 */}
        <aside className="w-80 lg:w-96 bg-white border-r border-gray-200 overflow-y-auto">
          {/* 0번 부지 정보 — ParcelInfoPanel 임베드 (inQuoteMode) */}
          <SectionHeader
            step={0}
            title="부지 정보"
            isExpanded={activeStep === 0}
            onClick={() => toggleStep(0)}
          />
          {activeStep === 0 && (
            <ParcelInfoPanel
              jibun={jibun}
              geometry={geometry}
              capa={capa}
              meta={meta}
              clickedJibun={jibun?.jibun ?? ""}
              matchMode={jibun ? "exact" : null}
              nearestJibun={null}
              loading={loadingParcel}
              onClose={() => {}}
              polygonCount={loadingBuildings ? undefined : buildings.length}
              inQuoteMode
            />
          )}
          <SectionHeader
            step={1}
            title="영역 정의"
            isExpanded={activeStep === 1}
            onClick={() => toggleStep(1)}
          />
          {activeStep === 1 && (
          <div className="px-4 py-3 space-y-3">
            {loadingBuildings ? (
              <div className="text-gray-500 text-sm">
                건물 폴리곤 불러오는 중…
              </div>
            ) : (
              <>
                {/* 합계 카드 — 필지 면적 / 자동 감지 건물 */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="px-2 py-1.5 bg-amber-50 border border-amber-200 rounded">
                    <div className="text-[10px] text-amber-800 font-semibold">
                      필지 면적
                    </div>
                    <div className="text-base font-bold text-gray-900 tabular-nums">
                      {parcelPyeong != null
                        ? `${parcelPyeong.toLocaleString()}평`
                        : "—"}
                    </div>
                    <div className="text-[10px] text-gray-500 tabular-nums truncate">
                      {geometry
                        ? `${geometry.area_m2.toLocaleString()}㎡`
                        : ""}
                      {geometry?.jimok ? ` · ${geometry.jimok}` : ""}
                    </div>
                  </div>
                  <div className="px-2 py-1.5 bg-emerald-50 border border-emerald-200 rounded">
                    <div className="text-[10px] text-emerald-800 font-semibold">
                      자동 감지
                    </div>
                    <div className="text-base font-bold text-gray-900 tabular-nums">
                      {buildings.length === 0
                        ? "0평"
                        : `${buildingPyeong.toLocaleString()}평`}
                    </div>
                    <div className="text-[10px] text-gray-500 tabular-nums">
                      {buildings.length}동 ·{" "}
                      {buildingArea.toLocaleString()}㎡
                    </div>
                  </div>
                </div>

                {/* 동별 영역 편집 카드 + 빈 상태 안내 */}
                {buildings.length === 0 ? (
                  <>
                    {bldgRegister.length === 0 && (
                      <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 leading-snug">
                        자동 감지된 건물도, 등록된 건축물대장도 없습니다.
                        <br />
                        노지/빈 토지 부지로 보입니다 — 위 [+ 영역 추가]
                        로 패널 깔 영역을 잡습니다.
                      </div>
                    )}
                    {bldgRegister.length > 0 && (
                      <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-300 rounded px-2 py-1.5 leading-snug">
                        ⚠️ 건축물대장에 <b>{bldgRegister.length}동</b> 등록되어
                        있지만 도로명주소가 미부여되어 자동 폴리곤 데이터가
                        없습니다.
                        <br />
                        위성 사진을 보고 위 [+ 영역 추가] 로 직접 그려주세요.
                      </div>
                    )}
                  </>
                ) : (
                  <ul className="space-y-1.5 text-xs">
                    {buildings.map((b, i) => {
                      const id = makeBuildingId(b);
                      const py = Math.round(b.edited_area_m2 * M2_TO_PYEONG);
                      const origPy = Math.round(b.area_m2 * M2_TO_PYEONG);
                      const isUserAdded = b.source === "user_added";

                      const vertexCount = b.edited_polygon[0]
                        ? Math.max(0, b.edited_polygon[0].length - 1)
                        : 0;

                      const isSelected = selectedBuildingId === id;
                      return (
                        <li
                          key={id}
                          onClick={(e) => {
                            // 안 쪽 button(stepper / 🗑) 클릭은 bubble 무시
                            if ((e.target as HTMLElement).closest("button"))
                              return;
                            handleSelectBuilding(id);
                          }}
                          className={`flex items-center justify-between gap-1.5 px-2 py-1.5 border rounded group cursor-pointer transition-all ${
                            isSelected
                              ? "ring-2 ring-yellow-400 border-yellow-500 bg-yellow-50"
                              : isUserAdded
                                ? "bg-emerald-50/70 border-emerald-200 hover:border-emerald-400"
                                : b.is_edited
                                  ? "bg-blue-50/80 border-blue-200 hover:border-blue-400"
                                  : "bg-orange-50/60 border-orange-100 hover:border-orange-300"
                          }`}
                        >
                          <span className="text-gray-700 truncate flex-1 min-w-0">
                            {b.buld_nm || `${i + 1}동`}
                            {!isUserAdded && (
                              <span className="text-gray-400 ml-1">
                                {b.gro_flo_co}F
                              </span>
                            )}
                            {b.is_edited && (
                              <span className="ml-1 text-[10px] text-blue-700 font-semibold">
                                수정
                              </span>
                            )}
                          </span>
                          <span className="font-semibold tabular-nums shrink-0 text-gray-900">
                            {py.toLocaleString()}평
                            {b.is_edited && !isUserAdded && (
                              <span className="text-gray-400 font-normal ml-1 line-through">
                                {origPy.toLocaleString()}평
                              </span>
                            )}
                          </span>
                          <div className="flex items-stretch shrink-0 border border-emerald-300 rounded overflow-hidden text-[10px] font-semibold leading-none">
                            <button
                              onClick={() => handleAutoRemoveVertex(id)}
                              disabled={vertexCount <= 3}
                              className="text-emerald-700 bg-emerald-50 hover:bg-emerald-200 disabled:bg-gray-50 disabled:text-gray-300 disabled:cursor-not-allowed px-1.5 py-1"
                              title={
                                vertexCount <= 3
                                  ? "최소 3점 — 더 줄일 수 없습니다"
                                  : "각도 가장 평평한 점 자동 삭제 (모양 거의 보존)"
                              }
                              aria-label="점 줄이기"
                            >
                              −
                            </button>
                            <span className="text-emerald-800 bg-emerald-100 px-1.5 py-1 tabular-nums">
                              점 {vertexCount}
                            </span>
                            <button
                              onClick={() => handleAutoAddVertex(id)}
                              className="text-emerald-700 bg-emerald-50 hover:bg-emerald-200 px-1.5 py-1"
                              title="가장 긴 변 가운데에 점 추가"
                              aria-label="점 늘리기"
                            >
                              +
                            </button>
                          </div>
                          <button
                            onClick={() => setDeletePendingId(id)}
                            className="text-gray-400 hover:text-red-600 text-sm leading-none px-1"
                            title="이 동 삭제"
                            aria-label="삭제"
                          >
                            🗑
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* + 영역 추가 — 동별 카드 리스트 아래 (더 추가하는 흐름) */}
                <button
                  onClick={handleAddBuilding}
                  disabled={!geometry}
                  className="w-full text-xs font-semibold py-2 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed border border-dashed border-blue-300 rounded transition-colors"
                  title="부지 중앙에 15m × 15m 사각형이 등장합니다 — 꼭지점 드래그로 조정"
                >
                  + 영역 추가
                </button>
              </>
            )}
          </div>
          )}
          <SectionHeader
            step={2}
            title="시설별 견적"
            isExpanded={activeStep === 2}
            onClick={() => toggleStep(2)}
          />
          {activeStep === 2 && (
          <div className="px-4 py-3 space-y-2">
            {buildings.length === 0 ? (
              <div className="text-xs text-gray-400">
                먼저 1단계에서 영역을 정의해주세요.
              </div>
            ) : (
              <>
                {facilityRows.map((row, i) => (
                  <FacilityCard
                    key={row.id}
                    index={i + 1}
                    row={row}
                    isEditingSpec={editingSpecId === row.id}
                    onFacilityChange={(kind) =>
                      handleFacilityChange(row.id, kind)
                    }
                    onResetFacility={() => handleResetFacility(row.id)}
                    onSpecChange={(spec) => handleSpecChange(row.id, spec)}
                    onResetSpec={() => handleResetSpec(row.id)}
                    onToggleEditSpec={() =>
                      setEditingSpecId((prev) =>
                        prev === row.id ? null : row.id,
                      )
                    }
                  />
                ))}
                <div className="mt-3 px-3 py-2.5 bg-gradient-to-br from-emerald-50 to-blue-50 border border-emerald-200 rounded">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-emerald-800 font-semibold">
                      💰 합계
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {buildings.length}동
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-base font-bold text-emerald-900 tabular-nums">
                      {formatKw(totalKw)}
                    </span>
                    <span className="text-base font-bold text-emerald-900 tabular-nums">
                      {formatCost(totalCost)}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
          )}
          <SectionHeader
            step={3}
            title="패널 시각화"
            isExpanded={activeStep === 3}
            onClick={() => toggleStep(3)}
          />
          {activeStep === 3 && (
          <div className="px-4 py-3 space-y-2">
            {buildings.length === 0 ? (
              <div className="text-xs text-gray-400">
                먼저 1단계에서 영역을 정의해주세요.
              </div>
            ) : (
              <>
                {/* 모듈 카드 — 맨 위 고정 (동 추가돼도 위치 안 밀림) */}
                <ModuleCard
                  module={activeModule}
                  isCustom={isCustomModule}
                  isEditing={isEditingModule}
                  onToggleEdit={() => setIsEditingModule((v) => !v)}
                  onApply={(m) => {
                    setCustomModule(m);
                    setIsEditingModule(false);
                  }}
                  onReset={() => {
                    setCustomModule(null);
                    setIsEditingModule(false);
                  }}
                  onCancel={() => setIsEditingModule(false)}
                />

                {totalPanels === 0 ? (
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 leading-snug">
                    영역이 모듈 1장보다 작거나 가장자리 이격 적용 후 공간이
                    남지 않습니다. 영역을 더 크게 잡아주세요.
                  </div>
                ) : (
                  <>
                    {panelLayouts.map((l) => (
                  <div
                    key={l.id}
                    className="px-2.5 py-2 bg-white border border-rose-200 rounded"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-700">
                        <b>{l.name}</b>
                      </span>
                      <span className="text-[11px] text-gray-500 tabular-nums">
                        🔲 {l.count.toLocaleString()}장
                      </span>
                    </div>
                    <div className="text-sm font-bold text-rose-700 tabular-nums text-right">
                      {l.kwActual.toFixed(2)} kW
                    </div>
                  </div>
                ))}
                <div className="mt-3 px-3 py-2.5 bg-gradient-to-br from-rose-50 to-amber-50 border border-rose-200 rounded">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-rose-800 font-semibold">
                      🔲 합계
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {activeModule.name}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-base font-bold text-rose-900 tabular-nums">
                      {totalPanels.toLocaleString()} 장
                    </span>
                    <span className="text-base font-bold text-rose-900 tabular-nums">
                      {totalKwActual.toFixed(2)} kW
                    </span>
                  </div>
                </div>
                  </>
                )}
              </>
            )}
          </div>
          )}
          <SectionHeader
            step={4}
            title="배치도 PDF"
            isExpanded={activeStep === 4}
            onClick={() => toggleStep(4)}
          />
          {activeStep === 4 && (
            <div className="px-4 py-3 text-xs text-gray-400">
              4단계 작업 예정
            </div>
          )}
          <SectionHeader
            step={5}
            title="수지분석"
            isExpanded={activeStep === 5}
            onClick={() => toggleStep(5)}
          />
          {activeStep === 5 && (
            <div className="px-4 py-3 text-xs text-gray-400">
              5단계 작업 예정
            </div>
          )}
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
              onRemoveVertex={handleRemoveVertex}
              fallbackCenter={geometry?.center}
              selectedBuildingId={selectedBuildingId}
              onSelectBuilding={handleSelectBuilding}
              onRequestDelete={handleRequestDelete}
            />
          )}
          {(loadingParcel || loadingBuildings) && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-white/95 border border-gray-300 rounded-full px-3 py-1 text-xs text-gray-700 shadow">
              불러오는 중…
            </div>
          )}
        </main>
      </div>

      {/* 삭제 확인 중앙 모달 — 라벨 X / 좌측 카드 🗑 둘 다 트리거 가능 */}
      {pendingDeleteBuilding && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setDeletePendingId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-lg shadow-2xl border border-gray-200 px-5 py-4 w-[320px] max-w-[calc(100%-32px)]"
          >
            <div className="text-base font-bold text-gray-900 mb-1.5">
              영역 삭제
            </div>
            <div className="text-sm text-gray-700 leading-relaxed mb-4">
              <b className="text-red-600">{pendingDeleteBuilding.name}</b>{" "}
              <span className="text-gray-500 tabular-nums">
                ({pendingDeleteBuilding.pyeong.toLocaleString()}평)
              </span>{" "}
              을(를) 정말 삭제하시겠습니까?
              <br />
              <span className="text-xs text-gray-500">
                삭제하면 되돌릴 수 없습니다.
              </span>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeletePendingId(null)}
                className="px-3 py-1.5 text-sm text-gray-700 bg-white hover:bg-gray-100 border border-gray-300 rounded"
              >
                취소
              </button>
              <button
                onClick={() => {
                  handleDeleteBuilding(pendingDeleteBuilding.id);
                  setDeletePendingId(null);
                }}
                className="px-3 py-1.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded"
              >
                정말 삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 보조 컴포넌트
// ─────────────────────────────────────────────

function SectionHeader({
  step,
  title,
  isExpanded,
  onClick,
}: {
  step: number;
  title: string;
  isExpanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full flex items-center gap-2.5 pl-4 pr-3 py-3 border-b transition-colors text-left ${
        isExpanded
          ? "bg-blue-600 border-blue-700 shadow-sm"
          : "bg-white border-gray-200 hover:bg-blue-50"
      }`}
    >
      {/* 좌측 강조 바 (활성 시) */}
      {isExpanded && (
        <span
          className="absolute left-0 top-0 bottom-0 w-1 bg-blue-300"
          aria-hidden="true"
        />
      )}
      <span
        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
          isExpanded
            ? "bg-white text-blue-700"
            : "bg-gray-100 text-gray-500 border border-gray-300"
        }`}
      >
        {step}
      </span>
      <span
        className={`flex-1 text-sm font-semibold ${
          isExpanded ? "text-white" : "text-gray-800"
        }`}
      >
        {title}
      </span>
      <span
        className={`text-xs transition-transform shrink-0 ${
          isExpanded ? "text-white rotate-0" : "text-gray-400 -rotate-90"
        }`}
        aria-hidden="true"
      >
        ▼
      </span>
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-500 text-xs">{label}</span>
      <span className="font-semibold text-gray-900 tabular-nums">{value}</span>
    </div>
  );
}

interface FacilityRow {
  id: string;
  building: EditedBuilding;
  auto: FacilityKind;
  kind: FacilityKind;
  spec: FacilitySpec;
  py: number;
  kw: number;
  cost: number;
  isAutoKind: boolean;
  isCustomSpec: boolean;
}

interface FacilityCardProps {
  index: number;
  row: FacilityRow;
  isEditingSpec: boolean;
  onFacilityChange: (kind: FacilityKind) => void;
  onResetFacility: () => void;
  onSpecChange: (spec: FacilitySpec) => void;
  onResetSpec: () => void;
  onToggleEditSpec: () => void;
}

/**
 * 좌측 "2 시설별 견적" 동별 카드.
 * 시설 종류 셀렉트박스 + 단가 인라인 편집 + kW/시공비 표시.
 */
function FacilityCard({
  index,
  row,
  isEditingSpec,
  onFacilityChange,
  onResetFacility,
  onSpecChange,
  onResetSpec,
  onToggleEditSpec,
}: FacilityCardProps) {
  const { building: b, auto, kind, spec, py, kw, cost, isAutoKind, isCustomSpec } =
    row;
  const py_round = Math.round(py);
  const isUserAdded = b.source === "user_added";

  // 단가 인라인 편집 로컬 입력값 (확정 전까지 휘발)
  const [draftPyeong, setDraftPyeong] = useState(spec.pyeongPerKw.toString());
  const [draftCostMan, setDraftCostMan] = useState(
    (spec.costPerKw / 10000).toString(),
  );

  // 외부 spec 변경(시설 종류 변경/원래대로 등) 시 입력칸도 동기화
  useEffect(() => {
    setDraftPyeong(spec.pyeongPerKw.toString());
    setDraftCostMan((spec.costPerKw / 10000).toString());
  }, [spec, isEditingSpec]);

  const handleApply = () => {
    const p = Number(draftPyeong);
    const c = Number(draftCostMan);
    if (!Number.isFinite(p) || p <= 0) return;
    if (!Number.isFinite(c) || c <= 0) return;
    onSpecChange({ pyeongPerKw: p, costPerKw: c * 10000 });
    onToggleEditSpec();
  };

  return (
    <div
      className={`px-2.5 py-2 border rounded ${
        isCustomSpec || !isAutoKind
          ? "bg-blue-50/60 border-blue-200"
          : "bg-white border-gray-200"
      }`}
    >
      {/* 동명 + 평수 */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-xs text-gray-700 truncate">
            <b>{b.buld_nm || `${index}동`}</b>
          </span>
          {isUserAdded && (
            <span className="text-[9px] px-1 py-px bg-emerald-100 text-emerald-700 rounded shrink-0">
              사용자추가
            </span>
          )}
          {!isAutoKind && (
            <button
              onClick={onResetFacility}
              className="text-[9px] px-1 py-px bg-amber-100 text-amber-700 rounded hover:bg-amber-200 shrink-0"
              title={`자동 추천(${FACILITY_LABEL[auto]})으로 되돌리기`}
            >
              수동
            </button>
          )}
        </div>
        <span className="text-[11px] text-gray-500 tabular-nums shrink-0">
          {py_round.toLocaleString()}평
        </span>
      </div>

      {/* 시설 종류 셀렉트 */}
      <select
        value={kind}
        onChange={(e) => onFacilityChange(e.target.value as FacilityKind)}
        className="w-full text-xs text-gray-900 px-2 py-1 border border-gray-300 rounded bg-white hover:border-gray-400 focus:border-blue-500 focus:outline-none"
      >
        {FACILITY_KINDS.map((k) => (
          <option key={k} value={k}>
            {FACILITY_LABEL[k]}
            {k === auto ? " (자동)" : ""}
          </option>
        ))}
      </select>

      {/* 단가 표시 또는 편집 */}
      {!isEditingSpec ? (
        <div className="flex items-center justify-between gap-2 mt-1.5 text-[10px] text-gray-500">
          <span className="truncate">
            {spec.pyeongPerKw}평/kW ·{" "}
            {(spec.costPerKw / 10000).toLocaleString()}만/kW
            {isCustomSpec && (
              <span className="ml-1 text-blue-700 font-semibold">수정됨</span>
            )}
          </span>
          <button
            onClick={onToggleEditSpec}
            className="text-[10px] px-1.5 py-0.5 text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded shrink-0"
          >
            ✏ 단가
          </button>
        </div>
      ) : (
        <div className="mt-1.5 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-gray-700 w-20 shrink-0">1kW당 평수</span>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={draftPyeong}
              onChange={(e) => setDraftPyeong(e.target.value)}
              className="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded text-gray-900 bg-white tabular-nums focus:border-blue-500 focus:outline-none"
            />
            <span className="text-gray-500 shrink-0">평</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-gray-700 w-20 shrink-0">kW당 시공비</span>
            <input
              type="number"
              step="1"
              min="1"
              value={draftCostMan}
              onChange={(e) => setDraftCostMan(e.target.value)}
              className="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded text-gray-900 bg-white tabular-nums focus:border-blue-500 focus:outline-none"
            />
            <span className="text-gray-500 shrink-0">만원</span>
          </div>
          <div className="flex justify-between gap-1">
            {isCustomSpec ? (
              <button
                onClick={() => {
                  onResetSpec();
                  onToggleEditSpec();
                }}
                className="text-[10px] px-2 py-1 text-gray-600 bg-white hover:bg-gray-100 border border-gray-300 rounded"
              >
                원래대로
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-1">
              <button
                onClick={onToggleEditSpec}
                className="text-[10px] px-2 py-1 text-gray-600 bg-white hover:bg-gray-100 border border-gray-300 rounded"
              >
                취소
              </button>
              <button
                onClick={handleApply}
                className="text-[10px] px-2 py-1 text-white bg-blue-600 hover:bg-blue-700 rounded"
              >
                ✓ 적용
              </button>
            </div>
          </div>
        </div>
      )}

      {/* kW + 시공비 (큰 숫자 강조) */}
      <div className="flex items-baseline justify-between gap-2 mt-1.5 pt-1.5 border-t border-gray-100">
        <span className="text-sm font-bold text-emerald-700 tabular-nums">
          {formatKw(kw)}
        </span>
        <span className="text-sm font-bold text-gray-900 tabular-nums">
          {formatCost(cost)}
        </span>
      </div>
    </div>
  );
}

interface ModuleCardProps {
  module: PanelModule;
  isCustom: boolean;
  isEditing: boolean;
  onToggleEdit: () => void;
  onApply: (m: PanelModule) => void;
  onReset: () => void;
  onCancel: () => void;
}

/**
 * 패널 모듈 카드 — 디폴트(AIKO 670W) 표시 + 사용자 변경.
 * 의뢰자 추가 요청 (2026-04-27): "패널 크기가 회사마다 틀리니 가로/세로/높이 변수로 수정 가능"
 */
function ModuleCard({
  module,
  isCustom,
  isEditing,
  onToggleEdit,
  onApply,
  onReset,
  onCancel,
}: ModuleCardProps) {
  // 인라인 편집 로컬 입력값
  const [draftName, setDraftName] = useState(module.name);
  const [draftWidth, setDraftWidth] = useState(module.widthMm.toString());
  const [draftHeight, setDraftHeight] = useState(module.heightMm.toString());
  const [draftThickness, setDraftThickness] = useState(
    module.thicknessMm.toString(),
  );
  const [draftWatt, setDraftWatt] = useState(module.watt.toString());

  // 외부 module 변경(원래대로 클릭 등) 시 입력값 동기화
  useEffect(() => {
    setDraftName(module.name);
    setDraftWidth(module.widthMm.toString());
    setDraftHeight(module.heightMm.toString());
    setDraftThickness(module.thicknessMm.toString());
    setDraftWatt(module.watt.toString());
  }, [module, isEditing]);

  const handleApply = () => {
    const w = Number(draftWidth);
    const h = Number(draftHeight);
    const t = Number(draftThickness);
    const wp = Number(draftWatt);
    const name = draftName.trim();
    if (!name) return;
    if (!Number.isFinite(w) || w <= 0) return;
    if (!Number.isFinite(h) || h <= 0) return;
    if (!Number.isFinite(t) || t <= 0) return;
    if (!Number.isFinite(wp) || wp <= 0) return;
    onApply({
      name,
      widthMm: w,
      heightMm: h,
      thicknessMm: t,
      watt: wp,
    });
  };

  if (!isEditing) {
    return (
      <div
        className={`px-3 py-2 border rounded ${
          isCustom
            ? "bg-blue-50/60 border-blue-200"
            : "bg-white border-gray-200"
        }`}
      >
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[11px] font-semibold text-gray-700">
            🔧 {module.name}
            {isCustom && (
              <span className="ml-1 text-[10px] text-blue-700 font-bold">
                수정됨
              </span>
            )}
          </span>
          <button
            onClick={onToggleEdit}
            className="text-[10px] px-1.5 py-0.5 text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded shrink-0"
          >
            ✏ 모듈
          </button>
        </div>
        <div className="text-[10px] text-gray-500 tabular-nums leading-snug">
          {module.widthMm.toLocaleString()} × {module.heightMm.toLocaleString()}{" "}
          × {module.thicknessMm}mm · {module.watt}Wp
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded space-y-1.5">
      <div className="text-[11px] font-semibold text-amber-900 mb-1">
        🔧 모듈 사양 변경
      </div>
      <ModuleField label="모듈명" type="text">
        <input
          type="text"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          className="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded text-gray-900 bg-white focus:border-blue-500 focus:outline-none"
        />
      </ModuleField>
      <ModuleField label="가로" unit="mm">
        <input
          type="number"
          step="1"
          min="1"
          value={draftWidth}
          onChange={(e) => setDraftWidth(e.target.value)}
          className="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded text-gray-900 bg-white tabular-nums focus:border-blue-500 focus:outline-none"
        />
      </ModuleField>
      <ModuleField label="세로" unit="mm">
        <input
          type="number"
          step="1"
          min="1"
          value={draftHeight}
          onChange={(e) => setDraftHeight(e.target.value)}
          className="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded text-gray-900 bg-white tabular-nums focus:border-blue-500 focus:outline-none"
        />
      </ModuleField>
      <ModuleField label="두께" unit="mm">
        <input
          type="number"
          step="1"
          min="1"
          value={draftThickness}
          onChange={(e) => setDraftThickness(e.target.value)}
          className="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded text-gray-900 bg-white tabular-nums focus:border-blue-500 focus:outline-none"
        />
      </ModuleField>
      <ModuleField label="와트" unit="Wp">
        <input
          type="number"
          step="1"
          min="1"
          value={draftWatt}
          onChange={(e) => setDraftWatt(e.target.value)}
          className="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded text-gray-900 bg-white tabular-nums focus:border-blue-500 focus:outline-none"
        />
      </ModuleField>
      <div className="flex justify-between gap-1 pt-1">
        {isCustom ? (
          <button
            onClick={onReset}
            className="text-[10px] px-2 py-1 text-gray-600 bg-white hover:bg-gray-100 border border-gray-300 rounded"
            title="AIKO 670W 디폴트로 복원"
          >
            원래대로
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-1">
          <button
            onClick={onCancel}
            className="text-[10px] px-2 py-1 text-gray-600 bg-white hover:bg-gray-100 border border-gray-300 rounded"
          >
            취소
          </button>
          <button
            onClick={handleApply}
            className="text-[10px] px-2 py-1 text-white bg-blue-600 hover:bg-blue-700 rounded"
          >
            ✓ 적용
          </button>
        </div>
      </div>
    </div>
  );
}

function ModuleField({
  label,
  unit,
  children,
}: {
  label: string;
  unit?: string;
  type?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className="text-gray-700 w-12 shrink-0">{label}</span>
      {children}
      {unit && <span className="text-gray-500 shrink-0">{unit}</span>}
    </div>
  );
}

