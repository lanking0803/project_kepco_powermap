"use client";

/**
 * 단일 토스트 알림 — 지도 상단 중앙에 떠서 잠시 후 자동 사라짐.
 *
 * 단일 책임: 메시지 + (선택) 액션 버튼 + 닫기.
 * 자동 숨김 타이머 + 수동 닫기 버튼 둘 다 지원한다.
 *
 * 현재 검색 결과 클릭 시 "필터 자동 해제 + 되돌리기" 안내에 사용.
 */

import { useEffect } from "react";

interface Props {
  message: string;
  /** 액션 버튼 라벨 (예: "되돌리기") — 없으면 버튼 숨김 */
  actionLabel?: string;
  onAction?: () => void;
  onClose: () => void;
  /** 자동 숨김 (ms). 0이면 자동 숨김 안 함. 기본 6000 */
  duration?: number;
}

export default function Toast({
  message,
  actionLabel,
  onAction,
  onClose,
  duration = 6000,
}: Props) {
  // 일정 시간 후 자동 닫힘
  useEffect(() => {
    if (duration <= 0) return;
    const t = setTimeout(onClose, duration);
    return () => clearTimeout(t);
  }, [duration, onClose]);

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none max-w-[calc(100vw-32px)]">
      <div
        className="pointer-events-auto bg-gray-900 text-white text-xs rounded-lg shadow-2xl
                   px-4 py-2.5 flex items-start gap-3 border border-gray-700 max-w-md"
        role="status"
      >
        <span className="leading-snug whitespace-pre-line">{message}</span>
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={() => {
              onAction();
              onClose();
            }}
            className="text-blue-300 hover:text-blue-200 font-semibold whitespace-nowrap"
          >
            {actionLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-200 leading-none"
          aria-label="닫기"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
