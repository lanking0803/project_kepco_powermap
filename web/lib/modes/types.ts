/**
 * 모드 공통 타입 — registry 와 storage 가 공유.
 *
 * 모드별 고유 타입은 lib/modes/modes/{id}.ts 에 분리. 이 파일은
 * "모드 전반에서 공통으로 쓰는" 타입만 둔다.
 */
import type { ComponentType } from "react";

/** 검색 패널이 부모(Sidebar/MapClient)와 주고받는 공통 인터페이스. */
export interface DataModePanelProps {
  /** 검색 결과 변경 — 지도 마커 갱신용. 모드별 item 타입은 unknown, 부모에서 분기. */
  onResults?: (items: unknown[]) => void;
  /** 결과 카드 클릭 — 지도 강조 + 상세 패널 진입. */
  onItemClick?: (item: unknown) => void;
}

/** 검색 패널 컴포넌트 시그니처. */
export type DataModePanelComponent = ComponentType<DataModePanelProps>;
