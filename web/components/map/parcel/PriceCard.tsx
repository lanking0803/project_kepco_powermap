"use client";

/**
 * 가격 탭 섹션 카드 — 공매탭 Section 미러, 색상만 분리.
 *
 * 가격 탭 카드들 (필터/시세요약/차트/비교표/거래리스트/공시지가) 외곽 통일.
 *
 * accent:
 *   blue  — 실거래 기반 (영업 핵심 정보)
 *   gray  — 공시지가 등 보조/참고 정보
 */

interface Props {
  title: string;
  subtitle?: string;
  /** 카드 색상 톤 — 실거래(파랑) vs 공시지가(회색) 시각 분리 */
  accent?: "blue" | "gray";
  /** 우측 상단 액세서리 (예: 카운트 배지) */
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}

const ACCENT: Record<
  NonNullable<Props["accent"]>,
  { border: string; headerBg: string; headerBorder: string; title: string }
> = {
  blue: {
    border: "border-blue-200",
    headerBg: "bg-blue-50",
    headerBorder: "border-blue-100",
    title: "text-blue-900",
  },
  gray: {
    border: "border-gray-200",
    headerBg: "bg-gray-50",
    headerBorder: "border-gray-200",
    title: "text-gray-700",
  },
};

export default function PriceCard({
  title,
  subtitle,
  accent = "blue",
  rightSlot,
  children,
}: Props) {
  const c = ACCENT[accent];
  return (
    <div className={`rounded-md border ${c.border} overflow-hidden bg-white`}>
      <div
        className={`flex items-center gap-2 px-2.5 py-1.5 ${c.headerBg} border-b ${c.headerBorder}`}
      >
        <div className={`text-xs font-bold ${c.title} flex-1 min-w-0 truncate`}>
          {title}
          {subtitle && (
            <span className="ml-1.5 text-[10px] text-gray-500 font-normal">
              — {subtitle}
            </span>
          )}
        </div>
        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </div>
      <div className="px-2.5 py-2 bg-white">{children}</div>
    </div>
  );
}
