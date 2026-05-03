"use client";

/**
 * 데이터 모드 드롭다운 — 단일 책임: 현재 모드 표시 + 변경 이벤트.
 *
 * 옵션 목록/색/라벨/disabled 여부는 모두 lib/modes/registry 가 결정.
 * 본 컴포넌트는 그 정보를 그대로 렌더만 한다 (로직 X).
 *
 * 모드 추가 시 본 파일은 손대지 않는다 — registry.ts 만 수정.
 */
import {
  DATA_MODES,
  DATA_MODE_ORDER,
  isModeSelectable,
  type DataModeId,
} from "@/lib/modes/registry";

interface Props {
  mode: DataModeId;
  onChange: (next: DataModeId) => void;
  /** 외곽 추가 클래스 (사이드바 헤더 등에 맞춤) */
  className?: string;
}

/**
 * 트리거(닫힌 select)는 선택된 모드와 무관하게 중립색 고정.
 * 옵션은 <option> OS 네이티브 렌더 — Tailwind 클래스가 안 먹어서
 * 각 모드 primary 색을 inline style 로 지정.
 */
export default function ModeSelector({ mode, onChange, className = "" }: Props) {
  return (
    <select
      aria-label="데이터 모드"
      value={mode}
      onChange={(e) => onChange(e.target.value as DataModeId)}
      className={
        "w-full px-1.5 py-0.5 rounded text-[11px] font-semibold leading-tight border outline-none focus:ring-1 bg-white text-slate-700 border-slate-300 focus:ring-slate-400 " +
        className
      }
    >
      {DATA_MODE_ORDER.map((id) => {
        const m = DATA_MODES[id];
        const disabled = !isModeSelectable(id);
        const suffix = disabled && m.comingSoonLabel ? ` (${m.comingSoonLabel})` : "";
        return (
          <option
            key={id}
            value={id}
            disabled={disabled}
            style={
              disabled
                ? undefined
                : { color: m.colors.primary, fontWeight: 600 }
            }
          >
            {m.icon} {m.label}
            {suffix}
          </option>
        );
      })}
    </select>
  );
}
