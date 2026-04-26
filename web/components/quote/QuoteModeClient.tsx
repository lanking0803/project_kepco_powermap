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
import {
  createDefaultRect,
  calcAreaM2,
  polygonCenter,
  addVertex,
  removeVertex,
  findLongestEdge,
  findFlattestVertex,
} from "@/lib/geometry/polygon-edit";
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
                  <div className="text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1.5 leading-snug space-y-0.5">
                    <div>💡 흰 점 <b>드래그</b> = 위치 수정</div>
                    <div>우측 카드 <b>[− 점 N +]</b> = 점 갯수 조절 (자동)</div>
                    <div>흰 점 <b>더블클릭</b> = 그 점 정확히 삭제</div>
                    {editedCount > 0 && (
                      <div className="text-blue-900 font-semibold">
                        수정됨 {editedCount}동
                      </div>
                    )}
                  </div>
                )}
                <div className="text-[10px] text-gray-400 pt-0.5">
                  영역 추가/삭제는 우측 패널의 [+ 영역 추가] / 🗑 사용
                </div>
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
              onRemoveVertex={handleRemoveVertex}
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
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] text-gray-500 font-semibold">
                동별 상세
              </div>
              <button
                onClick={handleAddBuilding}
                disabled={!geometry}
                className="text-[11px] font-semibold px-2 py-1 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed border border-dashed border-blue-300 rounded transition-colors"
                title="부지 중앙에 15m × 15m 사각형이 등장합니다 — 꼭지점 드래그로 조정"
              >
                + 영역 추가
              </button>
            </div>
            {buildings.length === 0 ? (
              <div className="text-[11px] text-gray-400 text-center py-3 bg-gray-50 rounded border border-dashed border-gray-200">
                추가된 영역이 없습니다.
                <br />
                위 [+ 영역 추가] 로 시작하세요.
              </div>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {buildings.map((b, i) => {
                  const id = makeBuildingId(b);
                  const py = Math.round(b.edited_area_m2 * M2_TO_PYEONG);
                  const origPy = Math.round(b.area_m2 * M2_TO_PYEONG);
                  const isUserAdded = b.source === "user_added";
                  const isPendingDelete = deletePendingId === id;

                  // 빨간 모드 (삭제 확인) — 동 카드를 통째로 빨간 배경 + 두 버튼
                  if (isPendingDelete) {
                    return (
                      <li
                        key={id}
                        className="flex flex-col gap-1.5 px-2 py-1.5 bg-red-50 border border-red-300 rounded"
                      >
                        <div className="text-[11px] text-red-800 leading-snug">
                          <b>{b.buld_nm || `${i + 1}동`}</b>{" "}
                          <span className="text-red-600">{py.toLocaleString()}평</span>{" "}
                          을(를) 삭제하시겠습니까?
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => {
                              handleDeleteBuilding(id);
                              setDeletePendingId(null);
                            }}
                            className="flex-1 py-1 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded"
                          >
                            정말 삭제
                          </button>
                          <button
                            onClick={() => setDeletePendingId(null)}
                            className="flex-1 py-1 text-[11px] text-gray-600 bg-white hover:bg-gray-100 border border-gray-300 rounded"
                          >
                            취소
                          </button>
                        </div>
                      </li>
                    );
                  }

                  // 점 갯수 (closed ring 의 마지막 중복 제외)
                  const vertexCount = b.edited_polygon[0]
                    ? Math.max(0, b.edited_polygon[0].length - 1)
                    : 0;

                  // 일반 모드
                  return (
                    <li
                      key={id}
                      className={`flex items-center justify-between gap-1.5 px-2 py-1.5 border rounded group ${
                        isUserAdded
                          ? "bg-emerald-50/70 border-emerald-200"
                          : b.is_edited
                            ? "bg-blue-50/80 border-blue-200"
                            : "bg-orange-50/60 border-orange-100"
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
                      <span className="font-semibold tabular-nums shrink-0">
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
                        className="text-gray-400 hover:text-red-600 text-sm leading-none px-1 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
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
          </div>
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

