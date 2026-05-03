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

/** 경매 마을 마커 1개 — 같은 BJD(10자리)의 매물 N건을 묶은 그룹. */
export interface AuctionVillageMarkerData {
  /** 그룹 키 (BJD 10자리) — 클릭 콜백 식별자 */
  key: string;
  lat: number;
  lng: number;
  /** 그룹 내 매물 수 — 마커 안 숫자 + 카드 배지 */
  count: number;
  /** D-3 이내 매물 1건 이상 보유 — 펄스 강조용 */
  hasUrgent: boolean;
  /** 평균 할인율 0~1 (감정가 대비 최저가 ↓ 비율) — 카드 본체 메인 표시 */
  avgDiscountRatio: number;
  /** 가장 임박한 D-day (마감 제외). 모두 마감이면 null */
  minDaysLeft: number | null;
}

/** 필지 마을 마커 1개 — 같은 BJD(10자리)의 시설 N건을 묶은 그룹. */
export interface FacilityVillageMarkerData {
  /** 그룹 키 (BJD 10자리) — 클릭 콜백 식별자 */
  key: string;
  lat: number;
  lng: number;
  /** 그룹 내 시설 수 — 마커 안 숫자 + 카드 배지 */
  count: number;
  /** 그룹 내 최대 평수 — 마커 라벨 메인 표기 */
  maxPyeong: number;
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
   * 자연취락지구 폴리곤들 — 마을 폴리곤 안에 있는 0~N개.
   * MapClient 가 Turf.booleanIntersects 로 이미 솎아낸 결과만 들어옴.
   * 외각: number[][][] (한 폴리곤의 외곽링들), 외각: 폴리곤 N개.
   */
  uqVillagePolygons?: number[][][][];
  /** 자연취락지구 모드 활성 여부 — 마커는 이때만 표시. */
  uqMode?: boolean;
  /**
   * 자연취락지구 검색 결과 마커 — 줌 ≥ 8 에서 표시 (공매 dot 패턴 미러).
   * 클릭 시 onUqMarkerClick → 폴리곤 focus 흐름 (panTo + 줌인 + 폴리곤 강조).
   */
  uqMarkers?: Array<{
    mnum: string;
    lat: number;
    lng: number;
    /** ㎡ — 마커 라벨에 평수 압축 표기 */
    area_m2: number;
    polygon: number[][][];
    center: { lat: number; lng: number };
  }>;
  /** uq 마커 클릭 — MapClient 의 handleUqPolygonFocus 와 동일 시그니처. */
  onUqMarkerClick?: (village: {
    polygon: number[][][];
    center: { lat: number; lng: number };
  }) => void;
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
   * 경매 모드 ON 여부. true 일 때 매물 마커 표시.
   * 공매와 단일 라디오 구조라 둘이 동시에 true 일 일은 없음 (registry 정책).
   */
  auctionActive?: boolean;
  /** 경매 마을 마커 — BJD 10자리 단위로 그룹화한 결과. 빈 배열이면 표시 X. */
  auctionVillages?: AuctionVillageMarkerData[];
  /** 경매 마을 마커 클릭 콜백 — group key (BJD 10자리) 전달 */
  onAuctionVillageClick?: (key: string) => void;
  /**
   * 필지 모드 ON 여부. true 일 때 시설 마을 마커 표시.
   * 공매·경매와 단일 라디오 (registry 정책).
   */
  facilityActive?: boolean;
  /** 필지 마을 마커 — BJD 10자리 단위로 그룹화한 결과. 빈 배열이면 표시 X. */
  facilityVillages?: FacilityVillageMarkerData[];
  /** 필지 마을 마커 클릭 콜백 — group key (BJD 10자리) 전달 */
  onFacilityVillageClick?: (key: string) => void;
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

/** 평수(㎡→평) 압축 라벨 — 자연취락지구 마커 텍스트용.
 *  영업이 한 눈에 우선순위 판단할 수 있게 1~3자 안에 떨어지도록 단위 자동.
 *  예: 5,000㎡ → "1.5K", 100,000㎡ → "30K", 5,000,000㎡ → "1.5M" */
function formatPyeongCompact(m2: number): string {
  if (!Number.isFinite(m2) || m2 <= 0) return "—";
  const pyeong = m2 / 3.305785;
  if (pyeong >= 1_000_000) return `${(pyeong / 1_000_000).toFixed(1)}M`;
  if (pyeong >= 100_000) return `${Math.round(pyeong / 1000)}K`;
  if (pyeong >= 10_000) return `${(pyeong / 1000).toFixed(0)}K`;
  if (pyeong >= 1000) return `${(pyeong / 1000).toFixed(1)}K`;
  return `${Math.round(pyeong)}`;
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

// ─────────────────────────────────────────────
// 줌별 그룹핑 (Tier 3) — 줌 8~12 에서 sep 단위로 마을을 묶어 적은 수의 마커로 표시.
// 줌 ≤ 7 은 마을 카드 그대로 (현재 동작 유지).
//
// 카카오 SDK 클러스터러 대신 직접 그룹핑하는 이유:
//   - 클러스터러는 4,325개 마커를 매번 픽셀 격자로 인덱싱 (1.5~2초)
//   - sep 단위 = 한국 행정구역 기반, 데이터에 이미 있음 (DB 변경 0)
//   - 사용자에게 "도 → 시군 → 읍면 → 마을" 자연스러운 흐름
// ─────────────────────────────────────────────

/** 줌 레벨 → 그룹 단위 */
type GroupTier = "sido" | "sigungu" | "emd" | "ri";
function tierForLevel(level: number): GroupTier {
  if (level >= 12) return "sido";       // 시도 (~17개)
  if (level >= 9) return "sigungu";     // 시군구 (~250개)
  if (level >= 8) return "emd";         // 읍면동 (~3,500개)
  return "ri";                          // 마을 (현재 카드)
}

/**
 * 그룹 키 — 폴백으로 빈값 안전 + 상위 단위 포함으로 동명 안전.
 *  - 광역시/세종은 sep_1 비어있어 sep_2 사용
 *  - 세종은 sep_3 도 비어있어 sep_2 그대로 시군구 키로 사용
 *  - "동구" 같은 동명 시군구는 상위(시도) 키 포함으로 다른 그룹으로 분리
 */
function groupKey(row: MapSummaryRow, tier: GroupTier): string {
  const pick = (...vals: (string | null | undefined)[]) =>
    vals.find((v) => v && v.trim().length > 0)?.trim() ?? "";
  const sido = pick(row.addr_do, row.addr_si);
  const sigungu = pick(row.addr_gu, row.addr_si, row.addr_do);
  const emd = pick(row.addr_dong);
  if (tier === "sido") return sido;
  if (tier === "sigungu") return `${sido}|${sigungu}`;
  if (tier === "emd") return `${sido}|${sigungu}|${emd}`;
  return ""; // ri 은 그룹핑 안 함
}

/** 그룹 마커에 보일 라벨 (사용자 시각용).
 *  세분 단위가 비면(예: 세종 시군구 = null) 상위 단위로 자연 폴백. */
function groupLabel(row: MapSummaryRow, tier: GroupTier): string {
  // 빈 문자열도 falsy 로 취급하기 위해 명시적으로 trim 후 검사
  const pick = (...vals: (string | null | undefined)[]) =>
    vals.find((v) => v && v.trim().length > 0)?.trim() ?? "";
  const sido = pick(row.addr_do, row.addr_si);
  const sigungu = pick(row.addr_gu, row.addr_si, row.addr_do);
  const emd = pick(row.addr_dong);
  if (tier === "sido") return sido;
  if (tier === "sigungu") return sigungu;
  if (tier === "emd") return emd || sigungu || sido;
  return "";
}

/** 줌별 그룹 마커 HTML — 푸른 원 + 라벨 + 마을 수.
 *  globals.css 의 .kepco-group-marker 클래스와 함께 동작. */
function makeGroupMarkerHtml(label: string, count: number, tier: GroupTier, key: string): string {
  // tier 별 크기 — 시도(가장 줌아웃) 가 가장 큼
  const sizeClass = tier === "sido" ? "lg" : tier === "sigungu" ? "md" : "sm";
  const safeLabel = label.replace(/"/g, "&quot;");
  const safeKey = key.replace(/"/g, "&quot;");
  return `<div class="kepco-group-marker ${sizeClass}" data-group-key="${safeKey}">
    <div class="name">${safeLabel}</div>
    <div class="count">${count.toLocaleString()}</div>
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

/**
 * 경매 카드 마커 HTML — globals.css 의 .auction-card-marker 와 동작.
 *
 * 영업담당자 시각 위계 (의뢰자 의도 = 저가 매입 발굴):
 *   - 메인 (큰 글씨): 평균 할인율 (-50% 등) — amber 강조
 *   - 보조 (작은 글씨): D-day
 *   - 우측 배지: 매물 수 (count > 1)
 *
 * 라벨(동·가격) 미사용 — 의뢰자 의도("저가 매입") = 할인율 핵심.
 */
function makeAuctionCardHtml(
  bjdKey: string,
  pctLabel: string,
  dayLabel: string,
  count: number,
  isUrgent: boolean,
  isEnded: boolean,
): string {
  const showBadge = count > 1;
  const badgeText = count > 9999 ? "9999+" : String(count);
  const badge = showBadge ? `<span class="badge">${badgeText}</span>` : "";
  const safeId = bjdKey.replace(/"/g, "&quot;");
  return `<div class="auction-card-marker" data-auction-id="${safeId}" data-urgent="${isUrgent}" data-ended="${isEnded}">
    <div class="card">
      <div class="pct">${pctLabel}</div>
      <div class="day">${dayLabel}</div>
    </div>
    <div class="arrow"></div>
    ${badge}
  </div>`;
}

/**
 * 필지 카드 마커 HTML — globals.css 의 .facility-card-marker 와 동작.
 *
 * 영업담당자 시각 위계 (의뢰자 의도 = 타겟 시설 발굴):
 *   - 메인 (큰 글씨): 최대 평수 (예: "120평")
 *   - 보조 (작은 글씨): 시설 수 (예: "5건")
 *   - 우측 배지: 시설 수 (count > 1)
 */
function makeFacilityCardHtml(
  bjdKey: string,
  pyeongLabel: string,
  countLabel: string,
  count: number,
): string {
  const showBadge = count > 1;
  const badgeText = count > 9999 ? "9999+" : String(count);
  const badge = showBadge ? `<span class="badge">${badgeText}</span>` : "";
  const safeId = bjdKey.replace(/"/g, "&quot;");
  return `<div class="facility-card-marker" data-facility-id="${safeId}">
    <div class="card">
      <div class="pyeong">${pyeongLabel}</div>
      <div class="cnt">${countLabel}</div>
    </div>
    <div class="arrow"></div>
    ${badge}
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
  uqVillagePolygons = [],
  uqMode = false,
  uqMarkers = [],
  onUqMarkerClick,
  onbidActive = false,
  onbidVillages = [],
  auctionActive = false,
  auctionVillages = [],
  onOnbidVillageClick,
  onAuctionVillageClick,
  facilityActive = false,
  facilityVillages = [],
  onFacilityVillageClick,
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
  // 경매 마을 마커 오버레이 + rebuild + 클릭 콜백 (공매 패턴 미러)
  const auctionOverlaysRef = useRef<any[]>([]);
  const auctionRebuildRef = useRef<() => void>(() => {});
  const onAuctionClickRef = useRef(onAuctionVillageClick);
  onAuctionClickRef.current = onAuctionVillageClick;

  const facilityOverlaysRef = useRef<any[]>([]);
  const facilityRebuildRef = useRef<() => void>(() => {});
  const onFacilityClickRef = useRef(onFacilityVillageClick);
  onFacilityClickRef.current = onFacilityVillageClick;
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
    // 최대 줌아웃 레벨 제한 — 13/14 는 한반도보다 더 넓은 시각이라 의미 없고
    // 화면 안 row 수 폭증으로 프리징 유발. 12 = 한반도 전체 범위로 충분.
    map.setMaxLevel(12);
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
  // 마커 렌더링 — 뷰포트(bounds) 기반 + 줌별 sep 그룹핑 (Tier 3)
  //
  // 설계:
  //  1. 줌 ≤ 7 (상세): 화면 안 마을 카드 HTML 오버레이 풀링 (Tier 2).
  //  2. 줌 8~12 (광역): sep 단위 직접 그룹핑 → 적은 수의 큰 마커 (Tier 3).
  //     (SDK 클러스터러의 4,325개 픽셀 격자 인덱싱 비용 회피)
  //  3. rebuild 함수는 ref 에 저장 → 의존성 변경 시 effect 재실행 없이 함수만 갱신.
  //  4. idle 이벤트(팬/줌 종료)에 200ms debounce 후 rebuild 호출.
  //  5. bounds 동일하면 rebuild skip → idle 재발화해도 자기 루프 차단.
  //  6. rebuild 가 200ms 넘으면 onRenderingChange(true) 로 상위에 로딩 신호.
  //
  // 이전 구조: rows 2,678개 전부 SVG→PNG 변환→Marker 생성 → 초기 16초 병목.
  // ─────────────────────────────────────────────
  const rebuildRef = useRef<() => void>(() => {});
  // 카드 오버레이 풀 — addr → CustomOverlay. rebuild 시 폐기/재생성 대신
  // 같은 addr 인 오버레이는 innerHTML + position + zIndex 만 갱신해 DOM 재사용.
  // 줌 ≤ 7 (카드 표시) 영역 내 패닝/리렌더 시 가장 무거운 비용을 직접 절감.
  const overlayPoolRef = useRef<Map<string, any>>(new Map());
  // 그룹 마커 풀 — `${tier}:${groupKey}` → CustomOverlay. 줌 ≥ 8 일 때 사용.
  // 카드 풀과 분리 — tier 가 바뀌면 다른 키 공간이라 자연스럽게 격리됨.
  const groupOverlayPoolRef = useRef<Map<string, any>>(new Map());
  const lastBoundsKeyRef = useRef<string>("");
  const renderingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // rebuild 함수를 최신 props 반영해 매번 갱신 — effect 재실행 없이 함수만 갈아끼움
  useEffect(() => {
    rebuildRef.current = () => {
      const map = mapInstanceRef.current;
      if (!map) return;

      // 매 rebuild 시 markersByAddr 만 비움 (위임 클릭 핸들러가 참조).
      // 카드/그룹 오버레이는 풀링되어 보존됨.
      markersByAddrRef.current.clear();

      // 전기 마커는 공매 토글과 무관하게 항상 표시 (2026-05-02 의뢰자 결정)
      // 공매 마커는 z-index 가 위(50/100)라 자연스럽게 겹쳐 표시됨

      const bounds = map.getBounds();
      const level = map.getLevel();
      const tier = tierForLevel(level);
      const showCard = tier === "ri";

      // 색상/가시성/뷰포트 필터 — 화면 안 + 활성 색상 + 검색 결과만
      const filtered = rows.filter((r) => {
        if (visibleAddrs && !visibleAddrs.has(r.geocode_address)) return false;
        if (!colorFilter.has(colorForMarker(r))) return false;
        return bounds.contain(new window.kakao.maps.LatLng(r.lat, r.lng));
      });

      // tier 가 'ri' 가 아니면 카드 풀 모두 숨김. 'ri' 이면 그룹 풀 모두 숨김.
      // (다른 tier 끼리는 키 공간이 달라 자동 격리되지만, 명시적으로 끄는 게 안전)
      if (!showCard) {
        overlayPoolRef.current.forEach((o) => o.setMap(null));
      } else {
        groupOverlayPoolRef.current.forEach((o) => o.setMap(null));
      }

      // 결과 0 이면 양쪽 풀 모두 숨기고 종료.
      if (filtered.length === 0) {
        overlayPoolRef.current.forEach((o) => o.setMap(null));
        groupOverlayPoolRef.current.forEach((o) => o.setMap(null));
        return;
      }

      if (showCard) {
        // ───── 줌 ≤ 7: 마을 카드 (기존 동작 — 카드 풀링) ─────
        filtered.forEach((row) => {
          markersByAddrRef.current.set(row.geocode_address, { marker: null, row });
        });

        const pool = overlayPoolRef.current;
        const usedAddrs = new Set<string>();
        for (const row of filtered) {
          const addr = row.geocode_address;
          usedAddrs.add(addr);
          const isSelected = addr === selectedAddr;
          const li = row.addr_li && !row.addr_li.includes("기타지역") ? row.addr_li : "";
          const placeName = li || row.addr_dong || "";
          const html = makeMarkerHtml(
            addr,
            ratiosForMarker(row),
            row.total,
            isSelected,
            placeName,
            row.max_remaining_kw ?? 0
          );
          const position = new window.kakao.maps.LatLng(row.lat, row.lng);
          const zIndex = isSelected ? 10 : 3;

          let overlay = pool.get(addr);
          if (overlay) {
            overlay.setContent(html);
            overlay.setPosition(position);
            overlay.setZIndex(zIndex);
            overlay.setMap(map);
          } else {
            overlay = new window.kakao.maps.CustomOverlay({
              position,
              content: html,
              yAnchor: 1,
              xAnchor: 0.5,
              zIndex,
            });
            overlay.setMap(map);
            pool.set(addr, overlay);
          }
        }
        for (const [addr, overlay] of pool) {
          if (!usedAddrs.has(addr)) overlay.setMap(null);
        }
      } else {
        // ───── 줌 ≥ 8: sep 단위 그룹 마커 (Tier 3 신규) ─────
        // 1) 화면 안 마을을 tier 별 그룹으로 묶음 + centroid + count 계산
        interface Group {
          key: string;
          label: string;
          latSum: number;
          lngSum: number;
          count: number;
        }
        const groups = new Map<string, Group>();
        for (const row of filtered) {
          const key = groupKey(row, tier);
          if (!key) continue;
          const existing = groups.get(key);
          if (existing) {
            existing.latSum += row.lat;
            existing.lngSum += row.lng;
            existing.count += 1;
          } else {
            groups.set(key, {
              key,
              label: groupLabel(row, tier),
              latSum: row.lat,
              lngSum: row.lng,
              count: 1,
            });
          }
        }

        // 2) 그룹 풀링 — 같은 키면 setContent/setPosition 만, 새 키만 신규 생성.
        const pool = groupOverlayPoolRef.current;
        const usedKeys = new Set<string>();
        for (const g of groups.values()) {
          const poolKey = `${tier}:${g.key}`;
          usedKeys.add(poolKey);
          const centerLat = g.latSum / g.count;
          const centerLng = g.lngSum / g.count;
          const position = new window.kakao.maps.LatLng(centerLat, centerLng);
          const html = makeGroupMarkerHtml(g.label, g.count, tier, poolKey);

          let overlay = pool.get(poolKey);
          if (overlay) {
            overlay.setContent(html);
            overlay.setPosition(position);
            overlay.setMap(map);
          } else {
            overlay = new window.kakao.maps.CustomOverlay({
              position,
              content: html,
              yAnchor: 0.5,
              xAnchor: 0.5,
              zIndex: 3,
            });
            overlay.setMap(map);
            pool.set(poolKey, overlay);
          }
        }
        // 사라진 그룹 키는 숨김 (다른 tier 의 키도 자동 포함 — tier 전환 시 안전)
        for (const [k, overlay] of pool) {
          if (!usedKeys.has(k)) overlay.setMap(null);
        }
      }
    };
  }, [rows, colorFilter, visibleAddrs, selectedAddr, onMarkerClick]);

  // idle 리스너 (debounce 200ms) + 클릭 위임.
  // Tier 3 적용 후 KEPCO 클러스터러는 사용하지 않음 — 줌 8~12 는 직접 sep 그룹핑,
  // 줌 ≤ 7 은 카드 오버레이 풀링. SDK 클러스터러의 4,325개 마커 인덱싱 비용 제거가 핵심.
  useEffect(() => {
    if (!loaded || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    // idle: 팬/줌 종료. 200ms debounce + bounds 동일 시 skip 으로 자기 루프 차단.
    // 통합 핸들러 — 전기/공매/경매/필지 4개 rebuild 를 단일 idle 에서 순차 호출.
    // 이전: 모드별 idle 리스너 4개 → 줌 1번에 4번 풀 리빌드 (4,958ms 스크립트 시간).
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const runRebuild = () => {
      // 200ms 안에 끝나면 인디케이터 안 보여줌
      if (renderingTimerRef.current) clearTimeout(renderingTimerRef.current);
      renderingTimerRef.current = setTimeout(() => {
        onRenderingChange?.(true);
      }, 200);
      try {
        rebuildRef.current();
        // 모드별 rebuild 도 같은 사이클에서 실행 (각 ref 는 비활성 모드일 때 자체 가드로 즉시 return)
        onbidRebuildRef.current();
        auctionRebuildRef.current();
        facilityRebuildRef.current();
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

    // 그룹 마커 클릭 위임 (Tier 3) — data-group-key 로 식별.
    // 클릭 시 해당 그룹의 centroid 로 panTo + 2단계 줌인 (자연스러운 흐름).
    // 측정 모드면 그 점만 측정 점으로 추가.
    const onGroupClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const groupEl = target.closest<HTMLElement>(".kepco-group-marker");
      if (!groupEl) return;
      const key = groupEl.dataset.groupKey;
      if (!key) return;
      const overlay = groupOverlayPoolRef.current.get(key);
      if (!overlay) return;
      e.stopPropagation();
      const pos = overlay.getPosition();
      if (measureModeRef.current) {
        measureAddPointRef?.current?.(pos);
        return;
      }
      map.panTo(pos);
      // 2단계 줌인 — sido(12)→sigungu(10), sigungu(11)→emd(9) 등 자연스럽게.
      setTimeout(() => {
        const next = Math.max(1, map.getLevel() - 2);
        map.setLevel(next, { animate: true });
      }, 350);
    };
    containerEl?.addEventListener("click", onGroupClick);

    // 초기 렌더 (bounds 키 미설정 상태에서 1회)
    runRebuild();

    return () => {
      window.kakao.maps.event.removeListener(map, "idle", onIdle);
      containerEl?.removeEventListener("click", onCardClick);
      containerEl?.removeEventListener("click", onGroupClick);
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
    if (!loaded || !mapInstanceRef.current) return;
    rebuildRef.current();
  }, [rows, colorFilter, visibleAddrs, selectedAddr, loaded]);

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
  // 시각 위계 (마을 / 자연취락지구 / 필지)
  //
  // 의뢰자 컨펌 (2026-05-02): 마을은 약한 가이드, 자연취락지구는 영업 주인공,
  // 필지는 강한 핀포인트. 한 화면에 셋이 떠 있을 때 위계가 한눈에 보여야 함.
  //
  //   zIndex 5 — 필지 클릭 (주황)
  //   zIndex 3 — 마을 외곽선 (또렷한 파란 선, fill 0)  ← 자연취락지구 위로 올려 경계 명확
  //   zIndex 2 — 자연취락지구 (emerald, uq 모드 전용) ← 영업 주인공
  //   zIndex 1 — 마을 채우기 (거의 투명한 파란)        ← 약한 배경 가이드
  //
  // 마을 폴리곤을 "채우기 only" 와 "외곽선 only" 두 객체로 분리한 이유:
  // 자연취락지구가 마을 경계 너머로 확장되는 케이스(주산리 84% / 무창리 16% 등)
  // 가 실제 데이터의 정상 모습이라 booleanIntersects 로 통째 표시 중. 이때
  // 마을 외곽선만 자연취락지구 위에 또렷이 보여야 "이 마을 안 / 밖" 즉시 분간 가능.
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
      // (1) 채우기 — 약한 배경 (zIndex 1)
      const fill = new window.kakao.maps.Polygon({
        path,
        strokeWeight: 0,
        strokeOpacity: 0,
        fillColor: "#2563eb", // blue-600
        fillOpacity: 0.03,
        zIndex: 1,
      });
      fill.setMap(map);
      villagePolygonsRef.current.push(fill);

      // (2) 외곽선 — 또렷한 경계 (zIndex 3, 자연취락지구 위)
      const outline = new window.kakao.maps.Polygon({
        path,
        strokeWeight: 2,
        strokeColor: "#2563eb",
        strokeOpacity: 0.95,
        strokeStyle: "solid",
        fillOpacity: 0,
        zIndex: 3,
      });
      outline.setMap(map);
      villagePolygonsRef.current.push(outline);
    });
  }, [loaded, villagePolygon]);

  // ─────────────────────────────────────────────
  // 자연취락지구 — 마커(클러스터러) + 폴리곤 (카드/마커 클릭 시 1개 강조).
  //
  // 마커: kakao.maps.Marker + MarkerClusterer (KEPCO 패턴 미러).
  //   - 줌 ≥ 8: 클러스터러가 자동으로 묶어서 emerald 클러스터
  //   - 줌 ≤ 7: 클러스터러가 자동으로 풀어서 단독 emerald 마커 (centroid)
  //   - minLevel = LABEL_VISIBLE_LEVEL 이 자동 전환 임계값
  //
  // 폴리곤: 카드 본체 / 마커 클릭 시 그 1개만 강조 (의뢰자 의도 — 시각 노이즈 최소화).
  //   - uqVillagePolygons state 는 항상 0~1개 (또는 마을 클릭 시 시군구 응답).
  //   - 줌 분기 없음 — 폴리곤이 있으면 항상 그림.
  //
  // 마커 클릭 = onUqMarkerClick → MapClient handleUqPolygonFocus 흐름 재사용
  //            (panTo + setUqVillagePolygons([그 1개])).
  // ─────────────────────────────────────────────
  const uqPolygonsRef = useRef<any[]>([]);
  const uqClustererRef = useRef<any>(null);
  const uqMarkersRef = useRef<any[]>([]);
  // 클로저 stale 방지
  const onUqMarkerClickRef = useRef(onUqMarkerClick);
  onUqMarkerClickRef.current = onUqMarkerClick;
  // 마커 클릭 시 mnum → 입력 데이터 lookup (effect dep 폭증 방지)
  const uqMarkerDataRef = useRef(uqMarkers);
  uqMarkerDataRef.current = uqMarkers;

  /** emerald 마커 이미지 가공 — 평수(평) 압축 라벨 표시.
   *  공매 dot 안에 숫자 표기 패턴 미러. 형상은 KEPCO 카드+화살표 미러.
   *  같은 라벨끼리는 _uqImageCache 로 SVG/MarkerImage 재사용 — 100개 검색 결과 중
   *  중복 라벨 다수면 가공 횟수가 라벨 unique 수로 떨어진다. */
  const uqMarkerImageCacheRef = useRef<Map<string, any>>(new Map());

  const buildUqMarkerImage = (areaM2: number): any => {
    const label = formatPyeongCompact(areaM2);
    const cache = uqMarkerImageCacheRef.current;
    const hit = cache.get(label);
    if (hit) return hit;
    const cardW = 28;
    const cardH = 30;
    const arrowH = 8;
    const totalH = cardH + arrowH;
    const arrowPath = `M${cardW / 2 - 5} ${cardH} L${cardW / 2} ${totalH - 1} L${cardW / 2 + 5} ${cardH} Z`;
    const fontSize = label.length >= 4 ? 8 : 9;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${totalH}" viewBox="0 0 ${cardW} ${totalH}">
      <path d="${arrowPath}" fill="#10b981" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
      <rect x="0.75" y="0.75" width="${cardW - 1.5}" height="${cardH - 1.5}" rx="3" ry="3"
        fill="#10b981" stroke="white" stroke-width="1.5"/>
      <text x="${cardW / 2}" y="${cardH / 2 + fontSize / 3}" text-anchor="middle"
        font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="white">${label}</text>
      <line x1="${cardW / 2 - 4}" y1="${cardH - 0.5}" x2="${cardW / 2 + 4}" y2="${cardH - 0.5}"
        stroke="#10b981" stroke-width="1.5"/>
    </svg>`;
    const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    const image = new window.kakao.maps.MarkerImage(
      dataUri,
      new window.kakao.maps.Size(cardW, totalH),
      { offset: new window.kakao.maps.Point(cardW / 2, totalH) }, // 화살표 끝 = 좌표 지점
    );
    cache.set(label, image);
    return image;
  };

  /** 클러스터러 1회 생성 (emerald 톤, KEPCO 클러스터러 styles 패턴 미러).
   *  minLevel = LABEL_VISIBLE_LEVEL+1 = 8 — 줌 ≤ 7 에서 자동 분해되어 단독 마커 노출. */
  useEffect(() => {
    if (!loaded || !mapInstanceRef.current || uqClustererRef.current) return;
    const map = mapInstanceRef.current;
    const baseStyle = "color:white;text-align:center;border-radius:50%;font-weight:bold;border:2px solid white;background:rgba(16,185,129,0.95);";
    uqClustererRef.current = new window.kakao.maps.MarkerClusterer({
      map,
      averageCenter: true,
      minLevel: LABEL_VISIBLE_LEVEL + 1, // 줌 ≥ 8 에서만 클러스터, ≤ 7 은 자동 분해
      gridSize: 60,
      disableClickZoom: true,  // 클릭 핸들러로 직접 줌인 제어
      styles: [
        { width: "40px", height: "40px", lineHeight: "40px", fontSize: "12px", cssText: `${baseStyle}width:40px;height:40px;line-height:40px;font-size:12px;` },
        { width: "50px", height: "50px", lineHeight: "50px", fontSize: "13px", cssText: `${baseStyle}width:50px;height:50px;line-height:50px;font-size:13px;` },
        { width: "60px", height: "60px", lineHeight: "60px", fontSize: "14px", cssText: `${baseStyle}width:60px;height:60px;line-height:60px;font-size:14px;` },
      ],
    });
    // 클러스터 클릭 = 그 위치로 panTo + 1단계 줌인 (KEPCO 패턴 동일).
    window.kakao.maps.event.addListener(uqClustererRef.current, "clusterclick", (cluster: any) => {
      const center = cluster.getCenter();
      map.panTo(center);
      setTimeout(() => map.setLevel(map.getLevel() - 1, { animate: true }), 350);
    });
  }, [loaded]);

  /** 폴리곤 cleanup + 그리기 — 카드/마커 클릭 시 1개만(또는 마을 응답). 줌 분기 없음. */
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!loaded || !map) return;
    uqPolygonsRef.current.forEach((p) => p.setMap(null));
    uqPolygonsRef.current = [];
    if (!uqVillagePolygons || uqVillagePolygons.length === 0) return;
    uqVillagePolygons.forEach((polyRings) => {
      polyRings.forEach((ring) => {
        const path = ring.map(
          ([lng, lat]) => new window.kakao.maps.LatLng(lat, lng),
        );
        const polygon = new window.kakao.maps.Polygon({
          path,
          strokeWeight: 2,
          strokeColor: "#10b981",
          strokeOpacity: 1,
          strokeStyle: "solid",
          fillColor: "#10b981",
          fillOpacity: 0.35,
          zIndex: 2,
        });
        polygon.setMap(map);
        uqPolygonsRef.current.push(polygon);
      });
    });
  }, [loaded, uqVillagePolygons]);

  /** 마커 cleanup + 그리기 — uq 모드일 때 검색 결과 전체 centroid 마커 등록.
   *  클러스터러가 줌에 따라 자동으로 클러스터/단독 전환.
   *  마커 이미지는 평수 라벨 별로 캐시 (buildUqMarkerImage). */
  useEffect(() => {
    const clusterer = uqClustererRef.current;
    if (!loaded || !mapInstanceRef.current || !clusterer) return;
    if (uqMarkersRef.current.length > 0) {
      clusterer.removeMarkers(uqMarkersRef.current);
      uqMarkersRef.current = [];
    }
    if (!uqMode || !uqMarkers || uqMarkers.length === 0) return;
    const newMarkers = uqMarkers.map((m) => {
      const marker = new window.kakao.maps.Marker({
        position: new window.kakao.maps.LatLng(m.lat, m.lng),
        image: buildUqMarkerImage(m.area_m2),
      });
      // 단독 마커 클릭 = 카드 본체 클릭과 동일 (폴리곤 focus 흐름)
      window.kakao.maps.event.addListener(marker, "click", () => {
        const found = uqMarkerDataRef.current.find((x) => x.mnum === m.mnum);
        if (found) {
          onUqMarkerClickRef.current?.({
            polygon: found.polygon,
            center: found.center,
          });
        }
      });
      return marker;
    });
    clusterer.addMarkers(newMarkers);
    uqMarkersRef.current = newMarkers;
  }, [loaded, uqMode, uqMarkers]);

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

  // ─────────────────── 경매 마을 마커 (onbid 패턴 미러) ───────────────────
  useEffect(() => {
    auctionRebuildRef.current = () => {
      const map = mapInstanceRef.current;
      if (!map) return;

      // 기존 마커/오버레이 정리
      auctionOverlaysRef.current.forEach((o) => o.setMap(null));
      auctionOverlaysRef.current = [];

      if (!auctionActive || !auctionVillages || auctionVillages.length === 0) return;

      const level = map.getLevel();
      const showCard = level <= LABEL_VISIBLE_LEVEL;

      auctionVillages.forEach((v) => {
        const position = new window.kakao.maps.LatLng(v.lat, v.lng);
        const safeKey = v.key.replace(/"/g, "&quot;");

        if (showCard) {
          // 가까운 줌 — 카드. 평균 할인율 메인 + D-day 보조.
          const dayLabel =
            v.minDaysLeft == null ? "마감" : `D-${v.minDaysLeft}`;
          const pctLabel =
            v.avgDiscountRatio > 0
              ? `-${Math.round(v.avgDiscountRatio * 100)}%`
              : "신건";
          const html = makeAuctionCardHtml(
            safeKey,
            pctLabel,
            dayLabel,
            v.count,
            v.hasUrgent,
            v.minDaysLeft == null,
          );
          const overlay = new window.kakao.maps.CustomOverlay({
            position,
            content: html,
            yAnchor: 1,
            xAnchor: 0.5,
            zIndex: 100,
          });
          overlay.setMap(map);
          auctionOverlaysRef.current.push(overlay);
        } else {
          // 먼 줌 — 노랑 원. 안에 매물 수.
          const dotHtml = `<div class="auction-dot${v.hasUrgent ? " urgent" : ""}" data-auction-id="${safeKey}">${v.count > 1 ? v.count : ""}</div>`;
          const dotOverlay = new window.kakao.maps.CustomOverlay({
            position,
            content: dotHtml,
            yAnchor: 0.5,
            xAnchor: 0.5,
            zIndex: 50,
          });
          dotOverlay.setMap(map);
          auctionOverlaysRef.current.push(dotOverlay);
        }
      });
    };
  }, [auctionActive, auctionVillages]);

  useEffect(() => {
    if (!loaded || !mapInstanceRef.current) return;
    auctionRebuildRef.current();
  }, [loaded, auctionActive, auctionVillages]);

  // ─────────────────── 필지 마을 마커 (onbid/auction 패턴 미러) ───────────────────
  useEffect(() => {
    facilityRebuildRef.current = () => {
      const map = mapInstanceRef.current;
      if (!map) return;

      facilityOverlaysRef.current.forEach((o) => o.setMap(null));
      facilityOverlaysRef.current = [];

      if (!facilityActive || !facilityVillages || facilityVillages.length === 0)
        return;

      const level = map.getLevel();
      const showCard = level <= LABEL_VISIBLE_LEVEL;

      facilityVillages.forEach((v) => {
        const position = new window.kakao.maps.LatLng(v.lat, v.lng);
        const safeKey = v.key.replace(/"/g, "&quot;");

        if (showCard) {
          // 가까운 줌 — 카드. 평수 메인 + 시설 수 보조.
          const pyeongLabel =
            v.maxPyeong > 0
              ? `${Math.round(v.maxPyeong).toLocaleString()}평`
              : "—";
          const countLabel = `${v.count}건`;
          const html = makeFacilityCardHtml(
            safeKey,
            pyeongLabel,
            countLabel,
            v.count,
          );
          const overlay = new window.kakao.maps.CustomOverlay({
            position,
            content: html,
            yAnchor: 1,
            xAnchor: 0.5,
            zIndex: 100,
          });
          overlay.setMap(map);
          facilityOverlaysRef.current.push(overlay);
        } else {
          // 먼 줌 — 보라 원. 안에 시설 수.
          const dotHtml = `<div class="facility-dot" data-facility-id="${safeKey}">${v.count > 1 ? v.count : ""}</div>`;
          const dotOverlay = new window.kakao.maps.CustomOverlay({
            position,
            content: dotHtml,
            yAnchor: 0.5,
            xAnchor: 0.5,
            zIndex: 50,
          });
          dotOverlay.setMap(map);
          facilityOverlaysRef.current.push(dotOverlay);
        }
      });
    };
  }, [facilityActive, facilityVillages]);

  useEffect(() => {
    if (!loaded || !mapInstanceRef.current) return;
    facilityRebuildRef.current();
  }, [loaded, facilityActive, facilityVillages]);

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

  // 줌 변경 시 공매/경매/필지 rebuild — 통합 idle 핸들러(전기 useEffect)로 이전.
  // 별도 리스너 3개 제거 (idle 4번 호출 → 1번으로 압축).

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

  // 경매 마커 클릭 — 컨테이너 위임 (data-auction-id) (공매 패턴 미러)
  useEffect(() => {
    const container = mapRef.current;
    if (!container) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const marker = target?.closest("[data-auction-id]") as HTMLElement | null;
      if (!marker) return;
      const id = marker.getAttribute("data-auction-id");
      if (id) onAuctionClickRef.current?.(id);
    };
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, []);

  // 필지 마커 클릭 — 컨테이너 위임 (data-facility-id) (공매·경매 패턴 미러)
  useEffect(() => {
    const container = mapRef.current;
    if (!container) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const marker = target?.closest("[data-facility-id]") as HTMLElement | null;
      if (!marker) return;
      const id = marker.getAttribute("data-facility-id");
      if (id) onFacilityClickRef.current?.(id);
    };
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, []);

  return <div ref={mapRef} className="w-full h-full" />;
}
