/**
 * 모드별 영속화 — sessionStorage 단일 진입점.
 *
 * 책임:
 *   - 모든 모드 컴포넌트의 sessionStorage 접근 일원화
 *   - 키는 registry.sessionKey 가 단일 진실 공급원 (컴포넌트가 키 직접 정의 X)
 *   - SSR 가드 / JSON parse / quota 예외 처리 1곳에 집중
 *
 * 사용 패턴:
 *   const persisted = loadModeState<OnbidPersistedState>("onbid");
 *   saveModeState("onbid", { params, results });
 *   clearModeState("onbid");
 *
 * 모드별 PersistedState 타입은 lib/modes/modes/{id}.ts 에 정의.
 *
 * sessionStorage 선택 이유:
 *   - 검색 결과 = 한 영업 세션의 작업 컨텍스트 → 탭 닫으면 휘발 OK
 *   - 새로고침은 살아있음 (sessionStorage 의 기본 동작)
 *   - localStorage 가 필요한 경우는 "사용자 설정" 류로, 본 헬퍼와 별도 처리
 */
import { DATA_MODES, type DataModeId } from "./registry";

/** 모드 검색 상태 로드. 없거나 파싱 실패 시 null. */
export function loadModeState<T>(modeId: DataModeId): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(DATA_MODES[modeId].sessionKey);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** 모드 검색 상태 저장. quota 초과 등은 조용히 무시 (검색 동작 자체엔 영향 없음). */
export function saveModeState<T>(modeId: DataModeId, state: T): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      DATA_MODES[modeId].sessionKey,
      JSON.stringify(state),
    );
  } catch {
    // quota 초과 등 — 무시
  }
}

/** 모드 검색 상태 삭제. "초기화" 버튼이 호출. */
export function clearModeState(modeId: DataModeId): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(DATA_MODES[modeId].sessionKey);
}
