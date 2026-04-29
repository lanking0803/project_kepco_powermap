"use client";

/**
 * 지도 우상단 플로팅 도구 패널.
 *
 * 카카오맵 네이티브 UI와 유사한 배치:
 *   1) 지도/스카이뷰 탭 토글
 *   2) 오버레이 옵션 (스카이뷰일 때)
 *   3) 도구 버튼 (유망 부지, 거리재기)
 *   4) 줌 +/- 버튼
 *
 * 모든 요소를 하나의 컬럼으로 배치해 SDK 기본 컨트롤과의 중첩을 방지한다.
 */

type MapType = "roadmap" | "skyview" | "hybrid";

interface Props {
  measureActive: boolean;
  onToggleMeasure: () => void;
  topListActive: boolean;
  onToggleTopList: () => void;
  gpsActive: boolean;
  gpsAutoFollow: boolean;
  onToggleGps: () => void;
  onGpsRecenter: () => void;
  mapType: MapType;
  onMapTypeChange: (type: MapType) => void;
  /** 로드뷰 모드 활성 여부 — true면 지도 위 파란선 + 클릭 시 로드뷰 패널 */
  roadviewActive: boolean;
  onToggleRoadview: () => void;
  /** 지적편집도 오버레이 ON/OFF — 필지 경계를 배경으로 표시 */
  cadastralActive: boolean;
  onToggleCadastral: () => void;
  /** 공매 모드 ON/OFF — 캠코 매물 검색 사이드바 + 매물 마커.
   *  [전기] ↔ [공매] 데이터 모드는 상호 전환 (한 번에 하나). */
  onbidActive: boolean;
  onSetOnbid: (active: boolean) => void;
  /** 줌 레벨 (1~14, 숫자 작을수록 확대) */
  zoomLevel?: number;
  /** 줌 인/아웃 콜백 */
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  /** 공유 링크 복사 */
  onShare?: () => void;
}

export default function MapToolbar({
  measureActive,
  onToggleMeasure,
  topListActive,
  onToggleTopList,
  gpsActive,
  gpsAutoFollow,
  onToggleGps,
  onGpsRecenter,
  zoomLevel,
  mapType,
  onMapTypeChange,
  roadviewActive,
  onToggleRoadview,
  cadastralActive,
  onToggleCadastral,
  onbidActive,
  onSetOnbid,
  onZoomIn,
  onZoomOut,
  onShare,
}: Props) {
  return (
    <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-2">
      {/* ── 1A. 베이스 지도 형식 (지도 ↔ 스카이뷰, 상호 전환) ── */}
      <div className="flex rounded overflow-hidden shadow border border-gray-300 text-xs font-medium leading-none">
        <button
          type="button"
          onClick={() => onMapTypeChange("roadmap")}
          className={`px-3 py-[7px] transition-colors ${
            mapType === "roadmap"
              ? "bg-white text-gray-900 font-bold"
              : "bg-gray-100 text-gray-500 hover:bg-gray-50"
          }`}
        >
          지도
        </button>
        <button
          type="button"
          onClick={() =>
            onMapTypeChange(mapType === "roadmap" ? "hybrid" : "roadmap")
          }
          className={`px-3 py-[7px] border-l border-gray-300 transition-colors ${
            mapType !== "roadmap"
              ? "bg-white text-gray-900 font-bold"
              : "bg-gray-100 text-gray-500 hover:bg-gray-50"
          }`}
        >
          스카이뷰
        </button>
      </div>

      {/* ── 1B. 데이터 모드 (전기 ↔ 공매, 상호 전환 — 메인 데이터 레이어) ── */}
      <div className="flex rounded overflow-hidden shadow border border-gray-300 text-xs font-bold leading-none">
        <button
          type="button"
          onClick={() => onSetOnbid(false)}
          title="전기지도 — KEPCO 여유선로 마을 마커"
          className={`px-3 py-[7px] transition-colors ${
            !onbidActive
              ? "bg-blue-600 text-white"
              : "bg-white text-gray-600 hover:bg-blue-50"
          }`}
        >
          ⚡ 전기
        </button>
        <button
          type="button"
          onClick={() => onSetOnbid(true)}
          title="공매지도 — 캠코 부동산 매물 검색"
          className={`px-3 py-[7px] border-l border-gray-300 transition-colors ${
            onbidActive
              ? "bg-rose-600 text-white"
              : "bg-white text-gray-600 hover:bg-rose-50"
          }`}
        >
          🟥 공매
        </button>
      </div>

      {/* ── 1C. 부가 오버레이 (병렬, 데이터 모드와 무관하게 ON/OFF) ── */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleRoadview}
          title={roadviewActive ? "로드뷰 닫기" : "로드뷰"}
          className={`px-2.5 py-[7px] rounded shadow border text-xs font-bold leading-none transition-colors ${
            roadviewActive
              ? "bg-blue-500 text-white border-blue-600 hover:bg-blue-600"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
          }`}
        >
          로드뷰
        </button>
        <button
          type="button"
          onClick={onToggleCadastral}
          title={cadastralActive ? "지적편집도 끄기" : "지적편집도 — 필지 경계 표시"}
          className={`px-2.5 py-[7px] rounded shadow border text-xs font-bold leading-none transition-colors ${
            cadastralActive
              ? "bg-amber-500 text-white border-amber-600 hover:bg-amber-600"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
          }`}
        >
          지적도
        </button>
      </div>

      {/* ── 2. 스카이뷰 오버레이 옵션 ── */}
      {mapType !== "roadmap" && (
        <label
          className="flex items-center gap-1.5 bg-white/95 backdrop-blur
                     rounded shadow-sm border border-gray-200 px-2.5 py-1
                     text-[11px] text-gray-700 cursor-pointer select-none"
        >
          <input
            type="checkbox"
            checked={mapType === "hybrid"}
            onChange={(e) =>
              onMapTypeChange(e.target.checked ? "hybrid" : "skyview")
            }
            className="accent-blue-500 w-3.5 h-3.5"
          />
          도로·지명 표시
        </label>
      )}

      {/* ── 3. 도구 버튼 (비교 / 유망 부지 / 거리재기 / GPS / 공유) ── */}
      <div className="flex flex-col gap-px bg-white rounded-lg shadow border border-gray-200 p-1">
        <button
          type="button"
          onClick={onToggleTopList}
          title={topListActive ? "유망 부지 닫기" : "유망 부지 TOP 보기"}
          className={`w-10 h-10 md:w-8 md:h-8 rounded flex items-center justify-center text-sm
                     transition-colors ${
                       topListActive
                         ? "bg-amber-400 text-amber-950 hover:bg-amber-500"
                         : "bg-white text-gray-700 hover:bg-gray-100"
                     }`}
        >
          🌞
        </button>
        <button
          type="button"
          onClick={onToggleMeasure}
          title={measureActive ? "거리재기 종료" : "거리재기"}
          className={`w-10 h-10 md:w-8 md:h-8 rounded flex items-center justify-center text-sm
                     transition-colors ${
                       measureActive
                         ? "bg-blue-500 text-white hover:bg-blue-600"
                         : "bg-white text-gray-700 hover:bg-gray-100"
                     }`}
        >
          📏
        </button>
        <button
          type="button"
          onClick={gpsActive && !gpsAutoFollow ? onGpsRecenter : onToggleGps}
          title={
            !gpsActive
              ? "내 위치 추적"
              : gpsAutoFollow
                ? "위치 추적 종료"
                : "내 위치로 이동"
          }
          className={`w-10 h-10 md:w-8 md:h-8 rounded flex items-center justify-center text-sm
                     transition-colors ${
                       gpsActive
                         ? gpsAutoFollow
                           ? "bg-blue-500 text-white hover:bg-blue-600"
                           : "bg-blue-100 text-blue-600 hover:bg-blue-200 ring-2 ring-blue-400"
                         : "bg-white text-gray-700 hover:bg-gray-100"
                     }`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="8" cy="8" r="1" fill="currentColor" />
            <line x1="8" y1="0.5" x2="8" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="8" y1="13" x2="8" y2="15.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="0.5" y1="8" x2="3" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="13" y1="8" x2="15.5" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onShare}
          title="현재 지도 상태 링크 복사"
          className="w-10 h-10 md:w-8 md:h-8 rounded flex items-center justify-center text-sm
                     transition-colors bg-white text-gray-700 hover:bg-gray-100"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <circle cx="12" cy="3" r="2" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="4" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="12" cy="13" r="2" stroke="currentColor" strokeWidth="1.5" />
            <line x1="5.8" y1="7" x2="10.2" y2="4" stroke="currentColor" strokeWidth="1.5" />
            <line x1="5.8" y1="9" x2="10.2" y2="12" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>

      {/* ── 4. 줌 +/- ── */}
      <div className="flex flex-col bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
        <button
          type="button"
          onClick={onZoomIn}
          title="확대"
          className="w-10 h-10 md:w-8 md:h-8 flex items-center justify-center text-gray-600
                     hover:bg-gray-100 transition-colors text-base font-bold leading-none"
        >
          +
        </button>
        <div className="h-px bg-gray-200" />
        {zoomLevel != null && (
          <>
            <div
              className="w-10 h-5 md:w-8 flex items-center justify-center text-[10px] font-bold text-gray-500 tabular-nums select-none"
              title={`줌 레벨 ${zoomLevel}`}
            >
              {zoomLevel}
            </div>
            <div className="h-px bg-gray-200" />
          </>
        )}
        <button
          type="button"
          onClick={onZoomOut}
          title="축소"
          className="w-10 h-10 md:w-8 md:h-8 flex items-center justify-center text-gray-600
                     hover:bg-gray-100 transition-colors text-base font-bold leading-none"
        >
          −
        </button>
      </div>

      {/* ── 5. 나침반 (북쪽 고정) ── */}
      <div
        title="북쪽"
        className="w-10 h-10 md:w-8 md:h-8 bg-white rounded-full shadow border border-gray-200
                   flex items-center justify-center"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <polygon points="9,1 12,9 9,7.5 6,9" fill="#e53e3e" />
          <polygon points="9,17 6,9 9,10.5 12,9" fill="#a0aec0" />
          <text x="9" y="0.5" textAnchor="middle" fontSize="3.5" fontWeight="bold" fill="#e53e3e" fontFamily="Arial, sans-serif">N</text>
        </svg>
      </div>
    </div>
  );
}
