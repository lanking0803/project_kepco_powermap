/**
 * 데이터 모드 레지스트리 — 단일 진실 공급원(Single Source of Truth).
 *
 * "모드" = 지도 위에 띄우는 데이터 종류 (전기/공매/경매/취락지구/시설 등).
 * 원칙:
 *   1. 전기는 베이스 = 모든 모드와 항상 함께 표시
 *   2. 그 외 모드는 단일 선택 (라디오) — 동시에 1개만 ON
 *   3. 모드 추가 = 이 파일에 1개 항목 추가만 (UI/마커/사이드바 자동 분기)
 *
 * 색상은 여기 한 곳에서만 결정. 컴포넌트마다 bg-rose-* 같은 클래스를
 * 흩뿌리지 말고 DATA_MODES[mode].colors 를 참조할 것.
 *
 * Tailwind v4 oxide 스캐너는 정적 문자열만 인식한다. 본 파일에서
 * 클래스 문자열이 직접 등장하므로 별도 safelist 불필요.
 */
import type { DataModePanelComponent } from "./types";

/* ────────────────────────────────────────────────────────────────────
 *  타입
 * ──────────────────────────────────────────────────────────────────── */

/** 모드 안정 ID — sessionStorage 키, props 비교, URL 쿼리 등에 사용 */
export type DataModeId =
  | "default"   // 전기 (베이스)
  | "onbid"     // 공매 (운영중)
  | "uq"        // 자연취락지구 (개발중)
  | "auction"   // 경매 (예정)
  | "facility"; // 유리온실/축사/50평+ 시설 (예정)

/** 미개발 모드의 라이프사이클 */
export type ModeStatus = "live" | "building" | "planned";

export interface ModeColorTokens {
  /** 주 색 — 마커 채움, 카드 액센트, 폴리곤 stroke */
  primary: string;
  /** Tailwind bg-* 클래스 (옵션 배경) */
  bgClass: string;
  /** Tailwind text-* 클래스 */
  textClass: string;
  /** Tailwind border-* 클래스 */
  borderClass: string;
  /** 폴리곤 fill 색 (폴리곤 사용 모드만) */
  polygonFill?: string;
  /** 폴리곤 fillOpacity 0~1 */
  polygonOpacity?: number;
}

export interface DataModeConfig {
  id: DataModeId;
  /** 드롭다운/카드/툴팁 라벨 */
  label: string;
  /** 한 줄 설명 — 드롭다운 옵션 보조 텍스트 */
  description: string;
  /** 이모지 (드롭다운/카드/마커 라벨용) */
  icon: string;
  colors: ModeColorTokens;
  status: ModeStatus;
  /** 미개발 모드 옵션에 띄울 라벨 (예: "곧 출시", "Phase 3 예정") */
  comingSoonLabel?: string;
  /** 사이드바 검색 패널. default 는 null = 기존 사이드바 검색 UI 그대로. */
  searchPanel: DataModePanelComponent | null;
  /** sessionStorage 키 — 모드별 검색 상태 보존 (기존 키와 호환) */
  sessionKey: string;
}

/* ────────────────────────────────────────────────────────────────────
 *  레지스트리 본체
 *  Tailwind v4 가 정적 문자열로 인식하도록 클래스명은 직접 박아둔다.
 *  변경 시: 클래스명 동적 생성(템플릿) 금지.
 * ──────────────────────────────────────────────────────────────────── */

export const DATA_MODES: Record<DataModeId, DataModeConfig> = {
  default: {
    id: "default",
    label: "전기",
    description: "여유선로 용량 — 항상 베이스 표시",
    icon: "⚡",
    colors: {
      primary: "#2563eb",
      bgClass: "bg-blue-50",
      textClass: "text-blue-700",
      borderClass: "border-blue-300",
    },
    status: "live",
    searchPanel: null,
    sessionKey: "default_search_state_v1",
  },
  onbid: {
    id: "onbid",
    label: "공매",
    description: "캠코 공매 매물 — 저가 매입 + 영업",
    icon: "🏛",
    colors: {
      primary: "#e11d48",
      bgClass: "bg-rose-50",
      textClass: "text-rose-700",
      borderClass: "border-rose-300",
    },
    status: "live",
    // 공매 검색 패널은 OnbidSearchPanel — 마이그레이션 단계에서 등록.
    // 본 파일에서 import 하면 사이클 위험이 있어 일단 null, Sidebar 가 직접 분기.
    searchPanel: null,
    sessionKey: "onbid_search_state_v1",
  },
  uq: {
    id: "uq",
    label: "자연취락지구",
    description: "건폐율 60% — 창고/태양광 영업 발굴",
    icon: "🏘",
    colors: {
      primary: "#10b981",
      bgClass: "bg-emerald-50",
      textClass: "text-emerald-700",
      borderClass: "border-emerald-300",
      polygonFill: "#10b981",
      polygonOpacity: 0.3,
    },
    status: "live",
    // searchPanel 은 Sidebar 가 mode 분기로 직접 import. 본 필드는 향후
    // "동적 패널 분기 자동화" 로 갈 때 활용 (현재는 미사용 — null 유지).
    searchPanel: null,
    sessionKey: "uq_search_state_v1",
  },
  auction: {
    id: "auction",
    label: "경매",
    description: "법원 경매 물건 — 권리분석 포함",
    icon: "⚖️",
    colors: {
      primary: "#f59e0b",
      bgClass: "bg-amber-50",
      textClass: "text-amber-700",
      borderClass: "border-amber-300",
    },
    status: "live",
    searchPanel: null,
    sessionKey: "auction_search_state_v1",
  },
  facility: {
    id: "facility",
    label: "필지",
    description: "유리온실·축사·공장·창고·대형건물 발굴",
    icon: "🏭",
    colors: {
      primary: "#8b5cf6",
      bgClass: "bg-violet-50",
      textClass: "text-violet-700",
      borderClass: "border-violet-300",
    },
    status: "live",
    searchPanel: null,
    sessionKey: "facility_search_state_v1",
  },
};

/** 드롭다운 표시 순서 — 영업 우선순위 + 운영중 먼저 */
export const DATA_MODE_ORDER: DataModeId[] = [
  "default",
  "onbid",
  "uq",
  "auction",
  "facility",
];

/* ────────────────────────────────────────────────────────────────────
 *  헬퍼
 * ──────────────────────────────────────────────────────────────────── */

/** 모드 ID 검증 + 폴백. 미상 ID 는 default 로. */
export function getDataMode(id: string | null | undefined): DataModeConfig {
  if (id && id in DATA_MODES) return DATA_MODES[id as DataModeId];
  return DATA_MODES.default;
}

/** 선택 가능 여부 — status="live" 만 활성. building/planned 는 disabled. */
export function isModeSelectable(id: DataModeId): boolean {
  return DATA_MODES[id].status === "live";
}
