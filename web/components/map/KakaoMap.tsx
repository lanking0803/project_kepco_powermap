"use client";

import { useEffect, useRef, useState } from "react";
import type { MapSummaryRow, MarkerColor } from "@/lib/types";
import type { SolarMarker } from "@/lib/api/solar-permits";
import {
  colorForMarker,
  ratiosForMarker,
  STATUS_RED,
  STATUS_BLUE,
  type MarkerRatios,
} from "@/lib/markerColor";

const KAKAO_JS_KEY = process.env.NEXT_PUBLIC_KAKAO_JS_KEY || "";

declare global {
  interface Window {
    kakao: any;
  }
}

/** 공매 마을 마커 1개 — 같은 동의 매물 N건을 묶은 그룹. */
export interface OnbidVillageMarkerData {
  /** 그룹 키 (시도|시군구|동) — 클릭 콜백 식별자 */
  key: string;
  lat: number;
  lng: number;
  /** 그룹 내 매물 수 — 마커 안 숫자 + 카드 배지 */
  count: number;
  /** D-3 이내 매물 1건 이상 보유 — 펄스 강조용 */
  hasUrgent: boolean;
  /** 동/면/읍 명 — 가까운 줌 카드 라벨용 */
  emdName: string;
  /** 가장 임박한 D-day (마감 제외). 모두 마감이면 null */
  minDaysLeft: number | null;
}

interface Props {
  rows: MapSummaryRow[];
  /** 현재 활성화된 색상 필터 */
  colorFilter: Set<MarkerColor>;
  /** 마커 클릭 콜백 */
  onMarkerClick: (row: MapSummaryRow) => void;
  /** 데이터 변경 시 fitBounds용 키 */
  fitBoundsKey: number;
  /** 지도 인스턴스 준비 완료 시 호출 (편의 도구가 사용) */
  onMapReady?: (map: any) => void;
  /** 거리재기 등 특수 모드: true면 마커 클릭을 무시하고 커서를 crosshair로 바꾼다 */
  measureMode?: boolean;
  /**
   * 측정 모드일 때 마커 클릭으로 점을 추가할 함수가 담긴 ref.
   * onMarkerClick(상세보기)과는 분리해서 직접 호출 — closure 꼬임 방지.
   */
  measureAddPointRef?: React.MutableRefObject<((latlng: any) => void) | null>;
  /** 현재 선택된 마을의 geocode_address — halo 표시 */
  selectedAddr?: string | null;
  /** 지도 타입: "roadmap" | "skyview" | "hybrid" */
  mapType?: "roadmap" | "skyview" | "hybrid";
  /** 표시할 마을 주소 집합 — null이면 전체, Set이면 해당 마을만 표시 */
  visibleAddrs?: Set<string> | null;
  /** 마커 재구성 진행 상태 콜백 — true 가 200ms 이상 지속되면 상위에서 로딩 인디케이터 표시 */
  onRenderingChange?: (rendering: boolean) => void;
  /**
   * 로드뷰 모드 — true 면 지도 위에 파란선 오버레이(RoadviewOverlay) 표시 +
   * 지도 클릭 시 onRoadviewClick(latlng) 호출
   */
  roadviewActive?: boolean;
  /**
   * 로드뷰 패널이 보고있는 좌표 + 시야 방향 — 지도 위 위치 마커 동기화용.
   * pan: 도 단위 (0=북, 90=동, 180=남, 270=서). 없으면 부채꼴 없이 점만 표시.
   */
  roadviewPosition?: { lat: number; lng: number; pan?: number } | null;
  /** 로드뷰 모드에서 지도/파란선 클릭 시 호출 */
  onRoadviewClick?: (lat: number, lng: number) => void;
  /**
   * 지적편집도 오버레이 ON/OFF (카카오 `MapTypeId.USE_DISTRICT`).
   * 전국 필지 경계를 배경으로 표시. 줌 레벨 5 이하에서만 시각적으로 잘 보임.
   */
  cadastralActive?: boolean;
  /**
   * 지적편집도 ON 상태에서 지도 클릭 시 호출.
   * 충돌 방지: 측정/로드뷰 모드 활성 시 자동 비활성.
   */
  onParcelClick?: (lat: number, lng: number) => void;
  /**
   * 지도에 하이라이트할 필지 폴리곤 좌표.
   * [[[lng,lat], [lng,lat], ...], ...] 형태 (MultiPolygon 지원).
   * null 이면 폴리곤 제거.
   */
  highlightedParcel?: number[][][] | null;
  /**
   * 마을(리/읍면동) 행정구역 폴리곤 좌표. 같은 형식.
   * 마을 마커 클릭 시 해당 행정구역 영역에 옅은 음영 표시.
   */
  villagePolygon?: number[][][] | null;
  /**
   * 공매 모드 ON 여부. true 일 때 매물 마커 표시 + KEPCO 마커 시각적 비중 ↓.
   */
  onbidActive?: boolean;
  /**
   * 공매 마을 마커 — 매물을 동 단위로 그룹화한 결과. 빈 배열이면 표시 X.
   * 각 마을은 1 마커, count 가 매물 수.
   */
  onbidVillages?: OnbidVillageMarkerData[];
  /** 마을 마커 클릭 콜백 — group key 전달, MapClient 가 OnbidVillageCard 표시 */
  onOnbidVillageClick?: (key: string) => void;
  /**
   * 솔라 발전소 마커 — 입지 탭 활성 시 같은 리(BJD)의 좌표 보유 발전소들.
   * 같은 PNU 는 1 마커 + 갯수 배지.
   */
  solarMarkers?: SolarMarker[];
  /**
   * 솔라 마커 클릭 콜백 — marker.pnu 직접 사용 (좌표 변환 우회).
   * MapClient 가 기존 openParcelPanelOnJibunClick 그대로 재사용.
   */
  onSolarMarkerClick?: (marker: SolarMarker) => void;
}

/**
 * 새 마커 SVG — 3시설 병렬 + 정량 비율 표시.
 *
 * 각 줄은 가로 막대로, 빨강 길이가 "부족 비율(%)"을 의미한다.
 * 사용자는 한 마커만 봐도 시설별로 얼마나 부족한지 직관적으로 인지.
 *
 *   ┌─────────┐
 *   │██████▓▓│  ← 변전소  75% 부족
 *   │▓▓▓▓▓▓▓▓│  ← 주변압기 모두 여유
 *   │███▓▓▓▓▓│  ← 배전선로 38% 부족
 *   └────┬────┘
 *        ▼
 */
/** 고해상도(Retina) 디스플레이에서 선명하게 렌더링하기 위한 스케일 */
const DPR = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 3) : 1;

/**
 * SVG data-URI → Canvas(DPR 해상도) → PNG data-URI 변환.
 * 카카오맵 SDK가 MarkerImage를 CSS 픽셀 크기로 래스터화하기 때문에
 * 미리 고해상도 비트맵(PNG)으로 변환해 전달해야 레티나 디스플레이에서 선명하다.
 */
const _pngCache = new Map<string, string>();

function svgToPng(
  svgDataUri: string,
  logicalW: number,
  logicalH: number,
): Promise<string> {
  if (_pngCache.has(svgDataUri)) return Promise.resolve(_pngCache.get(svgDataUri)!);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(logicalW * DPR);
      canvas.height = Math.round(logicalH * DPR);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const png = canvas.toDataURL("image/png");
      _pngCache.set(svgDataUri, png);
      resolve(png);
    };
    img.onerror = () => resolve(svgDataUri); // fallback: SVG 그대로
    img.src = svgDataUri;
  });
}

function makeMarkerSvg(
  ratios: MarkerRatios,
  count: number,
  selected: boolean = false
): string {
  const cardW = 28;
  const cardH = 30;
  const arrowH = 8;
  const totalH = cardH + arrowH;

  // 선택 상태: 주황 테두리 + 드롭섀도, 일반: 얇은 회색 테두리
  const outlineColor = selected ? "#f97316" : "rgba(0,0,0,0.35)";
  const outlineWidth = selected ? 2.5 : 1;

  const showBadge = count > 1;
  const badgeText = count > 9999 ? "9999+" : String(count);
  const badgeWidth = badgeText.length <= 2 ? 18 : badgeText.length === 3 ? 22 : badgeText.length === 4 ? 28 : 34;
  const badgeH = 14;
  const badgeGap = 2; // 카드와 배지 사이 간격
  // 배지는 카드 우측 옆에 분리해 둬서 줄 위에 안 겹치게
  const w = showBadge ? cardW + badgeGap + badgeWidth : cardW;

  // 배지 위치 — 카드 옆, 세로 중앙
  const badgeX = cardW + badgeGap;
  const badgeY = (cardH - badgeH) / 2;

  const badge = showBadge
    ? `<rect x="${badgeX}" y="${badgeY}" width="${badgeWidth}" height="${badgeH}" rx="7" ry="7"
         fill="#1f2937" stroke="white" stroke-width="1.5"/>
       <text x="${badgeX + badgeWidth / 2}" y="${badgeY + 10}" text-anchor="middle"
         font-family="Arial, sans-serif" font-size="9" font-weight="bold" fill="white">${badgeText}</text>`
    : "";

  // 줄 3개의 y/x 좌표
  const stripeH = 6;
  const gap = 2;
  const startY = 4;
  const stripeX = 3;
  const stripeW = cardW - 6;

  /** 한 줄 그리기: 파란 배경(여유) + 빨간 오버레이(부족 비율 길이) */
  const stripe = (y: number, noPct: number): string => {
    const clampedNo = Math.max(0, Math.min(100, noPct));
    const redW = (stripeW * clampedNo) / 100;
    return `
      <rect x="${stripeX}" y="${y}" width="${stripeW}" height="${stripeH}" rx="1" fill="${STATUS_BLUE}"/>
      ${
        redW > 0
          ? `<rect x="${stripeX}" y="${y}" width="${redW.toFixed(2)}" height="${stripeH}" rx="1" fill="${STATUS_RED}"/>`
          : ""
      }
    `;
  };

  const y1 = startY;
  const y2 = startY + stripeH + gap;
  const y3 = startY + (stripeH + gap) * 2;

  const arrowPath = `M${cardW / 2 - 5} ${cardH} L${cardW / 2} ${totalH - 1} L${cardW / 2 + 5} ${cardH} Z`;

  // 선택 시 드롭섀도 필터
  const shadowFilter = selected
    ? `<defs><filter id="ds" x="-30%" y="-30%" width="160%" height="160%">
         <feDropShadow dx="0" dy="1" stdDeviation="2.5" flood-color="#f97316" flood-opacity="0.5"/>
       </filter></defs>`
    : "";
  const filterAttr = selected ? ' filter="url(#ds)"' : "";

  // DPR 배율로 래스터화 크기를 키워 고해상도 디스플레이에서 선명하게 표시
  const renderW = Math.round((w + 4) * DPR);
  const renderH = Math.round((totalH + 2) * DPR);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="-2 -2 ${w + 4} ${totalH + 2}">
    ${shadowFilter}
    <g${filterAttr}>
    <!-- 화살표 -->
    <path d="${arrowPath}" fill="white" stroke="${outlineColor}" stroke-width="${outlineWidth}" stroke-linejoin="round"/>
    <!-- 카드 본체 -->
    <rect x="0.5" y="0.5" width="${cardW - 1}" height="${cardH - 1}" rx="3" ry="3"
      fill="white" stroke="${outlineColor}" stroke-width="${outlineWidth}"/>
    <!-- 3개 시설 줄 (각각 비율 막대) -->
    ${stripe(y1, ratios.substNoPct)}
    ${stripe(y2, ratios.mtrNoPct)}
    ${stripe(y3, ratios.dlNoPct)}
    <!-- 화살표 이음새 마감 -->
    <line x1="${cardW / 2 - 5}" y1="${cardH - 0.5}" x2="${cardW / 2 + 5}" y2="${cardH - 0.5}"
      stroke="white" stroke-width="1.2"/>
    ${badge}
    </g>
  </svg>`;
  return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
}

/**
 * 마을 카드 마커 HTML — globals.css 의 .kepco-card-marker 스타일과 함께 동작.
 * SVG → PNG 변환을 거치지 않고 DOM 으로 직접 렌더해 2,678개 생성 시 16초 → 1초.
 *
 * @param ratios 시설별 부족 비율 (0~100)
 * @param count  마을 내 지번 수 (>1 일 때만 우측 뱃지 표시)
 * @param selected 선택 상태 (주황 테두리)
 * @param labelText 마을명 + 잔여용량 라벨 (줌 가까울 때만 표시 — 빈 문자열이면 라벨 숨김)
 * @param remainKw 잔여 용량(kW) — 라벨 색상 결정용
 */
function makeMarkerHtml(
  addr: string,
  ratios: MarkerRatios,
  count: number,
  selected: boolean,
  labelText: string,
  remainKw: number
): string {
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const showBadge = count > 1;
  const badgeText = count > 9999 ? "9999+" : String(count);
  const badge = showBadge ? `<span class="badge">${badgeText}</span>` : "";

  // 라벨 — labelText 가 있으면 표시 (mw/kw 변환은 호출부에서)
  const remainClass = remainKw > 0 ? "remain ok" : "remain no";
  const remainHtml =
    labelText && remainKw !== 0
      ? `<span class="${remainClass}">· ${
          remainKw >= 1000 ? `${(remainKw / 1000).toFixed(1)}MW` : `${remainKw.toLocaleString()}kW`
        }</span>`
      : "";
  const label = labelText
    ? `<div class="label"><span>${labelText}</span>${remainHtml}</div>`
    : "";

  // data-addr 로 클릭 위임 시 어느 마을인지 식별 (HTML 인젝션 방지를 위해 따옴표 이스케이프)
  const safeAddr = addr.replace(/"/g, "&quot;");
  return `<div class="kepco-card-marker" data-selected="${selected}" data-addr="${safeAddr}">
    <div class="card">
      <div class="bar" style="--no-pct:${clamp(ratios.substNoPct).toFixed(0)}%"></div>
      <div class="bar" style="--no-pct:${clamp(ratios.mtrNoPct).toFixed(0)}%"></div>
      <div class="bar" style="--no-pct:${clamp(ratios.dlNoPct).toFixed(0)}%"></div>
    </div>
    <div class="arrow"></div>
    ${badge}
    ${label}
  </div>`;
}

/** 마커 사이즈 헬퍼 — 카드 폭/총 높이 + 우측 배지 영역 고려 */
function markerSize(count: number): { w: number; h: number } {
  const cardW = 28;
  const cardH = 30;
  const arrowH = 8;
  const badgeGap = 2;
  const showBadge = count > 1;
  const badgeText = count > 9999 ? "9999+" : String(count);
  const badgeWidth = badgeText.length <= 2 ? 18 : badgeText.length === 3 ? 22 : badgeText.length === 4 ? 28 : 34;
  return {
    w: showBadge ? cardW + badgeGap + badgeWidth : cardW,
    h: cardH + arrowH,
  };
}

/**
 * 공매 카드 마커 HTML — globals.css 의 .onbid-card-marker 와 함께 동작.
 * 전기 카드(makeMarkerHtml) 와 동일한 형태/크기, 색상만 빨간 계열.
 *
 * @param cltrMngNo 물건관리번호 — 클릭 위임용 data-onbid-id
 * @param dayLabel  D-day 텍스트 (예: "D-3" / "마감")
 * @param count     같은 좌표 매물 수 (>1 일 때만 우측 배지)
 * @param isUrgent  D-3 이내 임박 — 펄스 + 진한 빨강
 * @param isEnded   마감 — 회색 처리
 * @param labelText 카드 아래 표시할 라벨 (예: "시종면 · 8.6억"). 빈 문자열이면 라벨 숨김
 */
function makeOnbidCardHtml(
  cltrMngNo: string,
  dayLabel: string,
  count: number,
  isUrgent: boolean,
  isEnded: boolean,
  labelText: string,
  priceLabel: string,
): string {
  const showBadge = count > 1;
  const badgeText = count > 9999 ? "9999+" : String(count);
  const badge = showBadge ? `<span class="badge">${badgeText}</span>` : "";

  const safeId = cltrMngNo.replace(/"/g, "&quot;");
  const labelHtml = labelText
    ? `<div class="label"><span>${labelText}</span>${priceLabel ? `<span class="price">· ${priceLabel}</span>` : ""}</div>`
    : "";

  return `<div class="onbid-card-marker" data-onbid-id="${safeId}" data-urgent="${isUrgent}" data-ended="${isEnded}">
    <div class="card">
      <div class="day">${dayLabel}</div>
      <div class="cat"></div>
    </div>
    <div class="arrow"></div>
    ${badge}
    ${labelHtml}
  </div>`;
}

export default function KakaoMap({
  rows,
  colorFilter,
  onMarkerClick,
  fitBoundsKey,
  onMapReady,
  measureMode = false,
  measureAddPointRef,
  selectedAddr = null,
  mapType = "roadmap",
  visibleAddrs = null,
  onRenderingChange,
  roadviewActive = false,
  roadviewPosition = null,
  onRoadviewClick,
  cadastralActive = false,
  onParcelClick,
  highlightedParcel = null,
  villagePolygon = null,
  onbidActive = false,
  onbidVillages = [],
  onOnbidVillageClick,
  solarMarkers = [],
  onSolarMarkerClick,
}: Props) {
  // 지적편집도/필지 콜백 — 클로저 stale 방지
  const onParcelClickRef = useRef(onParcelClick);
  onParcelClickRef.current = onParcelClick;
  const cadastralActiveRef = useRef(cadastralActive);
  cadastralActiveRef.current = cadastralActive;
  // 측정 모드 여부를 클릭 핸들러에서 참조하기 위한 ref
  // (state로 전달하면 마커 재생성이 발생하므로 ref로 우회)
  const measureModeRef = useRef(measureMode);
  measureModeRef.current = measureMode;
  // 로드뷰 클릭 콜백 — 클로저 stale 방지
  const onRoadviewClickRef = useRef(onRoadviewClick);
  onRoadviewClickRef.current = onRoadviewClick;
  // 로드뷰 모드 ref — 이벤트 핸들러에서 참조 (effect 재생성 없이)
  const roadviewActiveRef = useRef(roadviewActive);
  roadviewActiveRef.current = roadviewActive;
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const clustererRef = useRef<any>(null);
  const [loaded, setLoaded] = useState(false);
  const lastFitKeyRef = useRef(-1);
  // 마커 위 마을명 라벨(CustomOverlay) — 줌 인 했을 때만 표시
  const labelOverlaysRef = useRef<any[]>([]);
  // 줌 변경 리스너 핸들 (마커 effect 재실행 시 정리)
  const zoomListenerRef = useRef<any>(null);
  // 공매 마을 마커 오버레이 — onbidVillages 변경 시 재구성
  const onbidOverlaysRef = useRef<any[]>([]);
  // 솔라 발전소 마커 오버레이 — solarMarkers 변경 시 재구성 (입지 탭 토글)
  const solarOverlaysRef = useRef<any[]>([]);
  // 솔라 마커 클릭 콜백 — 클로저 stale 방지
  const onSolarMarkerClickRef = useRef(onSolarMarkerClick);
  onSolarMarkerClickRef.current = onSolarMarkerClick;
  // 공매 rebuild 함수 (props 갱신 시 closure 갱신용 ref)
  const onbidRebuildRef = useRef<() => void>(() => {});
  // 공매 마을 마커 클릭 콜백 — 클로저 stale 방지
  const onOnbidClickRef = useRef(onOnbidVillageClick);
  onOnbidClickRef.current = onOnbidVillageClick;
  // 마커 참조 맵 (geocode_address → kakao.maps.Marker) — 선택 변경 시 이미지 교체용
  const markersByAddrRef = useRef<Map<string, { marker: any; row: MapSummaryRow }>>(
    new Map()
  );
  // 선택 마커 펄스 링 오버레이
  const pulseOverlayRef = useRef<any>(null);

  /** 마을명 라벨을 보여줄 줌 레벨 임계값 (이하일 때 표시 — 카카오는 숫자 작을수록 확대) */
  const LABEL_VISIBLE_LEVEL = 7;

  // SDK 로드
  useEffect(() => {
    if (window.kakao?.maps) {
      setLoaded(true);
      return;
    }
    const script = document.createElement("script");
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&autoload=false&libraries=clusterer,services`;
    script.onload = () => window.kakao.maps.load(() => setLoaded(true));
    document.head.appendChild(script);
  }, []);

  // 지도 초기화
  useEffect(() => {
    if (!loaded || !mapRef.current || mapInstanceRef.current) return;

    const map = new window.kakao.maps.Map(mapRef.current, {
      center: new window.kakao.maps.LatLng(36.5, 127.8),
      level: 12,
    });
    mapInstanceRef.current = map;
    (window as any).__kepcoMap = map;

    // 사이드바 토글 / 윈도우 리사이즈 시 타일 재계산
    const ro = new ResizeObserver(() => map.relayout());
    ro.observe(mapRef.current);

    onMapReady?.(map);

    return () => ro.disconnect();
  }, [loaded, onMapReady]);

  // 지도 타입 변경
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!loaded || !map) return;
    const typeId =
      mapType === "skyview"
        ? window.kakao.maps.MapTypeId.SKYVIEW
        : mapType === "hybrid"
          ? window.kakao.maps.MapTypeId.HYBRID
          : window.kakao.maps.MapTypeId.ROADMAP;
    map.setMapTypeId(typeId);
  }, [loaded, mapType]);

  // 측정 모드 진입/해제 시 커서 모양 변경.
  // 카카오 SDK 내부 자식 요소가 자기 cursor를 설정하므로, body에 클래스를 토글해
  // globals.css 의 !important 규칙으로 전체를 강제한다.
  useEffect(() => {
    if (measureMode) {
      document.body.classList.add("measure-mode");
    } else {
      document.body.classList.remove("measure-mode");
    }
    return () => {
      document.body.classList.remove("measure-mode");
    };
  }, [measureMode]);


  // ─────────────────────────────────────────────
  // 마커 렌더링 — 뷰포트(bounds) 기반 동적 생성 + HTML CustomOverlay
  //
  // 설계:
  //  1. 클러스터러는 1회 생성 후 재사용, 위치만 가진 "숨김 마커"가 클러스터 묶음을 만듦.
  //  2. 줌 7 이하(상세 줌)에선 화면 안 마을 카드 HTML 오버레이 추가 표시.
  //  3. rebuild 함수는 ref 에 저장 → 의존성 변경 시 effect 재실행 없이 함수만 갱신.
  //  4. idle 이벤트(팬/줌 종료)에 200ms debounce 후 rebuild 호출.
  //  5. bounds 동일하면 rebuild skip → addMarkers 가 idle 재발화해도 자기 루프 차단.
  //  6. rebuild 가 200ms 넘으면 onRenderingChange(true) 로 상위에 로딩 신호.
  //
  // 이전 구조: rows 2,678개 전부 SVG→PNG 변환→Marker 생성 → 초기 16초 병목.
  // ─────────────────────────────────────────────
  const rebuildRef = useRef<() => void>(() => {});
  const overlayRef = useRef<any[]>([]);
  const lastBoundsKeyRef = useRef<string>("");
  const renderingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // rebuild 함수를 최신 props 반영해 매번 갱신 — effect 재실행 없이 함수만 갈아끼움
  useEffect(() => {
    rebuildRef.current = () => {
      const map = mapInstanceRef.current;
      const clusterer = clustererRef.current;
      if (!map || !clusterer) return;

      // 정리는 항상 실행 (모드 전환 시 잔재 제거)
      clusterer.clear();
      overlayRef.current.forEach((o) => o.setMap(null));
      overlayRef.current = [];
      markersByAddrRef.current.clear();

      // 공매 모드일 때는 전기 마커 숨김
      if (onbidActive) return;

      const bounds = map.getBounds();
      const level = map.getLevel();
      const showCard = level <= LABEL_VISIBLE_LEVEL;

      // 색상/가시성/뷰포트 필터 — 화면 안 + 활성 색상 + 검색 결과만
      const filtered = rows.filter((r) => {
        if (visibleAddrs && !visibleAddrs.has(r.geocode_address)) return false;
        if (!colorFilter.has(colorForMarker(r))) return false;
        return bounds.contain(new window.kakao.maps.LatLng(r.lat, r.lng));
      });

      if (filtered.length === 0) return;

      if (showCard) {
        // 카드 표시 줌(≤7): 클러스터/마커 없이 HTML 오버레이만.
        // markersByAddrRef 에 row 만 저장 (위임 클릭 핸들러가 row 조회용)
        overlayRef.current = filtered.map((row) => {
          markersByAddrRef.current.set(row.geocode_address, { marker: null, row });
          return row;
        }) as any[];
        // overlayRef 는 아래 카드 생성 블록에서 다시 채워짐 — 임시 placeholder
      } else {
        // 클러스터 표시 줌(≥8): 위치만 가진 마커로 클러스터링.
        // 단독으로 표시되는 마커 클릭 → 카드 보이는 줌(7)으로 자동 줌인.
        const hiddenMarkers = filtered.map((row) => {
          const position = new window.kakao.maps.LatLng(row.lat, row.lng);
          const marker = new window.kakao.maps.Marker({ position });
          markersByAddrRef.current.set(row.geocode_address, { marker, row });
          window.kakao.maps.event.addListener(marker, "click", () => {
            if (measureModeRef.current) {
              measureAddPointRef?.current?.(position);
              return;
            }
            // 단독 마커 → 부드럽게 중앙 이동 후 1단계 줌인
            map.panTo(position);
            setTimeout(() => map.setLevel(map.getLevel() - 1, { animate: true }), 350);
          });
          return marker;
        });
        clusterer.addMarkers(hiddenMarkers);
      }

      // 줌 가까울 때만 카드 HTML 오버레이 추가 (라벨도 카드 안에 포함)
      if (showCard) {
        overlayRef.current = filtered.map((row) => {
          const isSelected = row.geocode_address === selectedAddr;
          const li = row.addr_li && !row.addr_li.includes("기타지역") ? row.addr_li : "";
          const placeName = li || row.addr_dong || "";
          const html = makeMarkerHtml(
            row.geocode_address,
            ratiosForMarker(row),
            row.total,
            isSelected,
            placeName,
            row.max_remaining_kw ?? 0
          );
          const overlay = new window.kakao.maps.CustomOverlay({
            position: new window.kakao.maps.LatLng(row.lat, row.lng),
            content: html,
            yAnchor: 1,
            xAnchor: 0.5,
            zIndex: isSelected ? 10 : 3,
          });
          // 클릭은 지도 컨테이너 위임 핸들러에서 data-addr 로 식별 (별도 effect)
          overlay.setMap(map);
          return overlay;
        });
      }
    };
  }, [rows, colorFilter, visibleAddrs, selectedAddr, onMarkerClick, onbidActive]);

  // 클러스터러 1회 생성 + idle 리스너 (debounce 200ms)
  useEffect(() => {
    if (!loaded || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    if (!clustererRef.current) {
      clustererRef.current = new window.kakao.maps.MarkerClusterer({
        map,
        averageCenter: true,
        minLevel: 5,
        gridSize: 60,
        disableClickZoom: true,
        styles: [
          { width: "40px", height: "40px", background: "rgba(59,130,246,0.9)", color: "white", textAlign: "center", lineHeight: "40px", borderRadius: "50%", fontSize: "12px", fontWeight: "bold", border: "2px solid white" },
          { width: "50px", height: "50px", background: "rgba(59,130,246,0.9)", color: "white", textAlign: "center", lineHeight: "50px", borderRadius: "50%", fontSize: "13px", fontWeight: "bold", border: "2px solid white" },
          { width: "60px", height: "60px", background: "rgba(59,130,246,0.9)", color: "white", textAlign: "center", lineHeight: "60px", borderRadius: "50%", fontSize: "14px", fontWeight: "bold", border: "2px solid white" },
        ],
      });
      window.kakao.maps.event.addListener(clustererRef.current, "clusterclick", (cluster: any) => {
        const center = cluster.getCenter();
        if (measureModeRef.current) {
          measureAddPointRef?.current?.(center);
          return;
        }
        // 부드럽게 중앙 이동 후 1단계 줌인 (panTo 애니메이션 ~350ms 대기)
        map.panTo(center);
        setTimeout(() => map.setLevel(map.getLevel() - 1, { animate: true }), 350);
      });
    }

    // 공매는 클러스터러 사용 안 함 — 검색 결과가 많지 않고 모든 매물을
    // 빨간 원 오버레이로 직접 그리는 게 SDK 기본 파란 핀 회피에 단순.

    // idle: 팬/줌 종료. 200ms debounce + bounds 동일 시 skip 으로 자기 루프 차단.
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const runRebuild = () => {
      // 200ms 안에 끝나면 인디케이터 안 보여줌
      if (renderingTimerRef.current) clearTimeout(renderingTimerRef.current);
      renderingTimerRef.current = setTimeout(() => {
        onRenderingChange?.(true);
      }, 200);
      try {
        rebuildRef.current();
      } finally {
        if (renderingTimerRef.current) {
          clearTimeout(renderingTimerRef.current);
          renderingTimerRef.current = null;
        }
        onRenderingChange?.(false);
      }
    };
    const onIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const b = map.getBounds();
        const sw = b.getSouthWest();
        const ne = b.getNorthEast();
        const key = `${sw.getLat().toFixed(4)},${sw.getLng().toFixed(4)},${ne.getLat().toFixed(4)},${ne.getLng().toFixed(4)},${map.getLevel()}`;
        if (key === lastBoundsKeyRef.current) return; // 동일 bounds → 자기 루프 차단
        lastBoundsKeyRef.current = key;
        runRebuild();
      }, 200);
    };
    window.kakao.maps.event.addListener(map, "idle", onIdle);

    // 카드 클릭 위임 — 지도 컨테이너에 1회 등록. data-addr 로 마을 식별.
    const containerEl = mapRef.current;
    const onCardClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const card = target.closest<HTMLElement>(".kepco-card-marker");
      if (!card) return;
      const addr = card.dataset.addr;
      if (!addr) return;
      const entry = markersByAddrRef.current.get(addr);
      if (!entry) return;
      e.stopPropagation();
      const pos = new window.kakao.maps.LatLng(entry.row.lat, entry.row.lng);
      if (measureModeRef.current) {
        measureAddPointRef?.current?.(pos);
        return;
      }
      map.panTo(pos);
      onMarkerClickRef.current(entry.row);
    };
    containerEl?.addEventListener("click", onCardClick);

    // 초기 렌더 (bounds 키 미설정 상태에서 1회)
    runRebuild();

    return () => {
      window.kakao.maps.event.removeListener(map, "idle", onIdle);
      containerEl?.removeEventListener("click", onCardClick);
      if (idleTimer) clearTimeout(idleTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // onMarkerClick 을 ref 로 — 위임 핸들러 closure 가 stale 되지 않도록
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;

  // fitBounds — fitBoundsKey 변경 시 1회만. setBounds → idle → rebuild 자동 호출.
  useEffect(() => {
    if (!loaded || !mapInstanceRef.current) return;
    if (lastFitKeyRef.current === fitBoundsKey) return;
    lastFitKeyRef.current = fitBoundsKey;

    const map = mapInstanceRef.current;
    const filtered = rows.filter((r) => {
      if (visibleAddrs && !visibleAddrs.has(r.geocode_address)) return false;
      return colorFilter.has(colorForMarker(r));
    });
    if (filtered.length === 0) return;
    const bounds = new window.kakao.maps.LatLngBounds();
    filtered.forEach((r) => bounds.extend(new window.kakao.maps.LatLng(r.lat, r.lng)));
    map.setBounds(bounds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, fitBoundsKey]);

  // props 변경 시 rebuild 직접 호출 (idle 안 기다림)
  useEffect(() => {
    if (!loaded || !mapInstanceRef.current || !clustererRef.current) return;
    rebuildRef.current();
  }, [rows, colorFilter, visibleAddrs, selectedAddr, loaded, onbidActive]);

  // 선택 변경 시 펄스 링 (마커 자체는 rebuild 가 강조 처리)
  useEffect(() => {
    if (!loaded) return;
    const map = mapInstanceRef.current;
    if (pulseOverlayRef.current) {
      pulseOverlayRef.current.setMap(null);
      pulseOverlayRef.current = null;
    }
    if (selectedAddr && map) {
      const selRow = rows.find((r) => r.geocode_address === selectedAddr);
      if (selRow && selRow.lat != null && selRow.lng != null) {
        const pos = new window.kakao.maps.LatLng(selRow.lat, selRow.lng);
        const pulseHtml = `
          <div style="position:relative;width:0;height:0;">
            <div style="position:absolute;left:-20px;top:-20px;width:40px;height:40px;border-radius:50%;border:2.5px solid #f97316;animation:kepcoPulse 2s ease-out infinite;pointer-events:none;"></div>
            <style>@keyframes kepcoPulse{0%{transform:scale(0.5);opacity:0.7;}100%{transform:scale(2.5);opacity:0;}}</style>
          </div>`;
        pulseOverlayRef.current = new window.kakao.maps.CustomOverlay({
          position: pos, content: pulseHtml, yAnchor: 0.5, xAnchor: 0.5, zIndex: 1,
        });
        pulseOverlayRef.current.setMap(map);
      }
    }
  }, [loaded, selectedAddr, rows]);

  // ─────────────────────────────────────────────
  // 로드뷰 모드 — 파란선 오버레이 + 지도 클릭 핸들러
  // ─────────────────────────────────────────────
  const roadviewOverlayRef = useRef<any>(null);
  const roadviewClickListenerRef = useRef<any>(null);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!loaded || !map) return;

    if (roadviewActive) {
      if (!roadviewOverlayRef.current) {
        roadviewOverlayRef.current = new window.kakao.maps.RoadviewOverlay();
      }
      roadviewOverlayRef.current.setMap(map);
      // 로드뷰 모드 진입 시 적정 줌으로 자동 조정 (너무 멀면 파란선 보이지 않음)
      if (map.getLevel() > 5) map.setLevel(4);

      // 지도 클릭 → 로드뷰 위치 변경
      const onClick = (mouseEvent: any) => {
        if (!roadviewActiveRef.current) return;
        if (measureModeRef.current) return; // 측정 모드 중복 방지
        const latlng = mouseEvent.latLng;
        onRoadviewClickRef.current?.(latlng.getLat(), latlng.getLng());
      };
      window.kakao.maps.event.addListener(map, "click", onClick);
      roadviewClickListenerRef.current = onClick;
      // 모드 시작 시 커서를 손가락 모양으로 — 클릭 가능 표시
      document.body.classList.add("roadview-mode");
    } else {
      if (roadviewOverlayRef.current) {
        roadviewOverlayRef.current.setMap(null);
      }
      if (roadviewClickListenerRef.current) {
        window.kakao.maps.event.removeListener(
          map,
          "click",
          roadviewClickListenerRef.current,
        );
        roadviewClickListenerRef.current = null;
      }
      document.body.classList.remove("roadview-mode");
    }

    return () => {
      if (roadviewClickListenerRef.current) {
        window.kakao.maps.event.removeListener(
          map,
          "click",
          roadviewClickListenerRef.current,
        );
        roadviewClickListenerRef.current = null;
      }
      document.body.classList.remove("roadview-mode");
    };
  }, [loaded, roadviewActive]);

  // 로드뷰 위치 마커 — 현재 로드뷰가 보고있는 지점 표시
  const roadviewPositionMarkerRef = useRef<any>(null);
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!loaded || !map) return;

    if (!roadviewActive || !roadviewPosition) {
      if (roadviewPositionMarkerRef.current) {
        roadviewPositionMarkerRef.current.setMap(null);
      }
      return;
    }

    // 시야 부채꼴 — pan 이 있을 때만 그림 (60도 시야각, 위쪽이 북쪽)
    const pan = roadviewPosition.pan;
    const showCone = typeof pan === "number";
    const conePath = showCone
      ? `<path d="M 0 0 L -16 -28 A 32 32 0 0 1 16 -28 Z"
              fill="rgba(59,130,246,0.45)"
              stroke="rgba(59,130,246,0.85)" stroke-width="1.2"
              stroke-linejoin="round"/>`
      : "";
    const html = `
      <div style="position:relative;width:0;height:0;pointer-events:none;">
        <svg width="60" height="60" viewBox="-30 -30 60 60"
             style="position:absolute;left:-30px;top:-30px;overflow:visible;
                    transform:rotate(${showCone ? pan : 0}deg);transform-origin:center;
                    transition:transform 80ms linear;">
          ${conePath}
          <circle cx="0" cy="0" r="9" fill="#3b82f6" stroke="white" stroke-width="3"/>
        </svg>
      </div>`;
    const pos = new window.kakao.maps.LatLng(
      roadviewPosition.lat,
      roadviewPosition.lng,
    );
    if (!roadviewPositionMarkerRef.current) {
      roadviewPositionMarkerRef.current = new window.kakao.maps.CustomOverlay({
        position: pos,
        content: html,
        yAnchor: 0.5,
        xAnchor: 0.5,
        zIndex: 200,
      });
    } else {
      roadviewPositionMarkerRef.current.setPosition(pos);
      roadviewPositionMarkerRef.current.setContent(html);
    }
    roadviewPositionMarkerRef.current.setMap(map);
  }, [loaded, roadviewActive, roadviewPosition]);

  // ─────────────────────────────────────────────
  // 지적편집도 오버레이 (카카오 MapTypeId.USE_DISTRICT)
  // 전국 필지 경계를 배경 이미지 타일로 표시. 필지 개별 선택은 별도(VWorld) 필요.
  //
  // 2026-04-25: VWorld LX 편집지적도(lt_c_landinfobasemap) WMS 오버레이 시도했으나
  // 카카오 SDK = EPSG:5181, VWorld = EPSG:3857 본질적 좌표계 비호환으로 포기.
  // 카카오 z/x/y → EPSG:5181 BBOX 변환 룰이 공개되지 않아 매핑 불가능.
  // 폴리곤(parcel.ts) 만 LX 로 정확. 배경 라벨은 카카오 USE_DISTRICT 그대로 유지.
  // ─────────────────────────────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!loaded || !map) return;
    const USE_DISTRICT = window.kakao.maps.MapTypeId.USE_DISTRICT;
    if (cadastralActive) {
      map.addOverlayMapTypeId(USE_DISTRICT);
    } else {
      map.removeOverlayMapTypeId(USE_DISTRICT);
    }
    return () => {
      map.removeOverlayMapTypeId(USE_DISTRICT);
    };
  }, [loaded, cadastralActive]);

  // ─────────────────────────────────────────────
  // 지적편집도 활성 시 지도 클릭 → 필지 조회 (onParcelClick)
  // 로드뷰/측정 모드 활성 시 자동 비활성 (기존 핸들러 우선).
  // ─────────────────────────────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!loaded || !map) return;
    const onClick = (mouseEvent: any) => {
      if (!cadastralActiveRef.current) return;
      if (measureModeRef.current) return;
      if (roadviewActiveRef.current) return; // 로드뷰 핸들러 우선
      const latlng = mouseEvent.latLng;
      onParcelClickRef.current?.(latlng.getLat(), latlng.getLng());
    };
    window.kakao.maps.event.addListener(map, "click", onClick);
    return () => {
      window.kakao.maps.event.removeListener(map, "click", onClick);
    };
  }, [loaded]);

  // ─────────────────────────────────────────────
  // 선택된 필지 하이라이트 — 주황 테두리 + 반투명 채움
  // ─────────────────────────────────────────────
  const highlightPolygonsRef = useRef<any[]>([]);
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!loaded || !map) return;

    // 기존 폴리곤 제거
    highlightPolygonsRef.current.forEach((p) => p.setMap(null));
    highlightPolygonsRef.current = [];

    if (!highlightedParcel || highlightedParcel.length === 0) return;

    // 각 ring 을 카카오 Polygon 으로 렌더
    highlightedParcel.forEach((ring) => {
      const path = ring.map(
        ([lng, lat]) => new window.kakao.maps.LatLng(lat, lng),
      );
      const polygon = new window.kakao.maps.Polygon({
        path,
        strokeWeight: 3,
        strokeColor: "#f97316", // orange-500
        strokeOpacity: 0.95,
        strokeStyle: "solid",
        fillColor: "#f97316",
        fillOpacity: 0.22,
        zIndex: 5, // 마을 음영(1) 위에 그려짐
      });
      polygon.setMap(map);
      highlightPolygonsRef.current.push(polygon);
    });
  }, [loaded, highlightedParcel]);

  // ─────────────────────────────────────────────
  // 마을(리/읍면동) 행정구역 음영 — 옅은 파란 채움
  // 같은 패턴이지만 ref 분리: 필지 폴리곤(주황)과 독립 표시
  // ─────────────────────────────────────────────
  const villagePolygonsRef = useRef<any[]>([]);
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!loaded || !map) return;

    villagePolygonsRef.current.forEach((p) => p.setMap(null));
    villagePolygonsRef.current = [];

    if (!villagePolygon || villagePolygon.length === 0) return;

    villagePolygon.forEach((ring) => {
      const path = ring.map(
        ([lng, lat]) => new window.kakao.maps.LatLng(lat, lng),
      );
      const polygon = new window.kakao.maps.Polygon({
        path,
        strokeWeight: 2,
        strokeColor: "#2563eb", // blue-600
        strokeOpacity: 0.85,
        strokeStyle: "solid",
        fillColor: "#2563eb",
        fillOpacity: 0.08,
        zIndex: 1, // 필지 폴리곤(5) 아래 — 가려지지 않게
      });
      polygon.setMap(map);
      villagePolygonsRef.current.push(polygon);
    });
  }, [loaded, villagePolygon]);

  // ─────────────────────────────────────────────
  // 공매 매물 마커 — 전기와 동일 패턴 (줌별 카드/클러스터 분기).
  // 좌표는 PNU 앞 10자리 → bjd_master JOIN 결과 (동/리 단위).
  // 같은 동 매물 여러 건이면 같은 위치 — 그룹화하여 배지(매물 수) 표시.
  // ─────────────────────────────────────────────

  // rebuild 함수 — 최신 props 반영. 그룹화는 부모(MapClient) 가 이미 한 상태.
  useEffect(() => {
    onbidRebuildRef.current = () => {
      const map = mapInstanceRef.current;
      if (!map) return;

      // 기존 마커/오버레이 정리
      onbidOverlaysRef.current.forEach((o) => o.setMap(null));
      onbidOverlaysRef.current = [];

      if (!onbidActive || !onbidVillages || onbidVillages.length === 0) return;

      const level = map.getLevel();
      const showCard = level <= LABEL_VISIBLE_LEVEL;

      onbidVillages.forEach((v) => {
        const position = new window.kakao.maps.LatLng(v.lat, v.lng);
        const safeKey = v.key.replace(/"/g, "&quot;");

        if (showCard) {
          // 가까운 줌 — 카드. D-day 대신 매물 수 강조.
          const dayLabel =
            v.minDaysLeft == null ? "마감" : `D-${v.minDaysLeft}`;
          const html = makeOnbidCardHtml(
            safeKey,
            dayLabel,
            v.count,
            v.hasUrgent,
            v.minDaysLeft == null,
            v.emdName,
            `${v.count}건`,
          );
          const overlay = new window.kakao.maps.CustomOverlay({
            position,
            content: html,
            yAnchor: 1,
            xAnchor: 0.5,
            zIndex: 100,
          });
          overlay.setMap(map);
          onbidOverlaysRef.current.push(overlay);
        } else {
          // 먼 줌 — 빨간 원. 안에 매물 수.
          const dotHtml = `<div class="onbid-dot${v.hasUrgent ? " urgent" : ""}" data-onbid-id="${safeKey}">${v.count > 1 ? v.count : ""}</div>`;
          const dotOverlay = new window.kakao.maps.CustomOverlay({
            position,
            content: dotHtml,
            yAnchor: 0.5,
            xAnchor: 0.5,
            zIndex: 50,
          });
          dotOverlay.setMap(map);
          onbidOverlaysRef.current.push(dotOverlay);
        }
      });
    };
  }, [onbidActive, onbidVillages]);

  // 공매 모드/데이터 변경 시 rebuild 직접 호출
  useEffect(() => {
    if (!loaded || !mapInstanceRef.current) return;
    onbidRebuildRef.current();
  }, [loaded, onbidActive, onbidVillages]);

  // ─────────────────── 솔라 발전소 마커 ───────────────────
  // 입지 탭 활성 시 같은 리(BJD) 발전소들을 마커로 표시.
  // 같은 PNU 의 발전소는 1개 마커 + 갯수 배지로 그룹화.
  // 클릭 → onParcelClickRef (지도 클릭과 동일 흐름) → ParcelInfoPanel 그 PNU 로 이동.
  useEffect(() => {
    if (!loaded || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    // 기존 솔라 오버레이 정리
    solarOverlaysRef.current.forEach((o) => o.setMap(null));
    solarOverlaysRef.current = [];

    if (!solarMarkers || solarMarkers.length === 0) return;

    // PNU 단위 그룹화 — 같은 필지에 발전소 여러 개면 1 마커 + 갯수 배지
    interface SolarGroup {
      lat: number;
      lng: number;
      jibun: string;
      count: number;
      totalKw: number;
      names: string[];
      first: SolarMarker; // 클릭 시 그대로 onSolarMarkerClick 으로 forward
    }
    const groups = new Map<string, SolarGroup>();
    for (const m of solarMarkers) {
      const existing = groups.get(m.pnu);
      if (existing) {
        existing.count += 1;
        existing.totalKw += m.kw ?? 0;
        if (existing.names.length < 3) existing.names.push(m.name);
      } else {
        groups.set(m.pnu, {
          lat: m.lat,
          lng: m.lng,
          jibun: m.jibun,
          count: 1,
          totalKw: m.kw ?? 0,
          names: [m.name],
          first: m,
        });
      }
    }

    groups.forEach((g) => {
      const div = document.createElement("div");
      div.className = "solar-card-marker";
      const tooltip =
        g.names.join(" / ") +
        (g.totalKw > 0 ? ` (${g.totalKw.toFixed(0)} kW)` : "");
      div.title = tooltip;
      const badge =
        g.count > 1
          ? `<span class="solar-marker-badge">${g.count}</span>`
          : "";
      div.innerHTML = `<span class="solar-marker-icon">☀</span><span class="solar-marker-jibun">${g.jibun}</span>${badge}`;
      div.addEventListener("click", (e) => {
        e.stopPropagation();
        // marker.pnu 그대로 전달 — MapClient 가 기존 jibun 클릭 흐름 재사용
        onSolarMarkerClickRef.current?.(g.first);
      });

      const overlay = new window.kakao.maps.CustomOverlay({
        position: new window.kakao.maps.LatLng(g.lat, g.lng),
        content: div,
        yAnchor: 0.5,
        xAnchor: 0.5,
        zIndex: 200, // 공매 (50/100) 위에
        clickable: true, // SDK 가 클릭 가능 영역으로 인식 → 지도 click 이벤트 차단 (이중 fetch 방지)
      });
      overlay.setMap(map);
      solarOverlaysRef.current.push(overlay);
    });

    return () => {
      solarOverlaysRef.current.forEach((o) => o.setMap(null));
      solarOverlaysRef.current = [];
    };
  }, [loaded, solarMarkers]);

  // 줌 변경 시 공매 rebuild (카드 ↔ 클러스터 전환)
  useEffect(() => {
    if (!loaded || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const onIdle = () => onbidRebuildRef.current();
    window.kakao.maps.event.addListener(map, "idle", onIdle);
    return () => {
      window.kakao.maps.event.removeListener(map, "idle", onIdle);
    };
  }, [loaded]);

  // 공매 마커 클릭 — 컨테이너 위임 (data-onbid-id)
  useEffect(() => {
    const container = mapRef.current;
    if (!container) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const marker = target?.closest("[data-onbid-id]") as HTMLElement | null;
      if (!marker) return;
      const id = marker.getAttribute("data-onbid-id");
      if (id) onOnbidClickRef.current?.(id);
    };
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, []);

  return <div ref={mapRef} className="w-full h-full" />;
}
