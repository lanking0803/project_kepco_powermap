/**
 * 만료일 D-day 배지.
 *
 * - null/undefined → "무기한" (회색)
 * - D-30 초과     → 검정 글씨 (정상)
 * - D-7 ~ D-30   → 노랑 (주의)
 * - D-day ~ D-7  → 빨강 (긴급)
 * - 만료됨       → 빨강 + 취소선
 */

interface Props {
  expiry: string | null | undefined;
  className?: string;
}

export default function ExpiryBadge({ expiry, className = "" }: Props) {
  if (!expiry) {
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600 ${className}`}
      >
        무기한
      </span>
    );
  }

  const expiryDate = new Date(expiry);
  if (isNaN(expiryDate.getTime())) {
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600 ${className}`}
      >
        {expiry}
      </span>
    );
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiryMs = expiryDate.getTime();
  const diffDays = Math.ceil((expiryMs - today.getTime()) / 86400000);

  if (diffDays < 0) {
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-red-100 text-red-700 line-through ${className}`}
        title={`${expiry} 만료됨`}
      >
        만료 ({-diffDays}일 경과)
      </span>
    );
  }

  let bg = "bg-gray-100";
  let fg = "text-gray-700";
  if (diffDays <= 7) {
    bg = "bg-red-100";
    fg = "text-red-700";
  } else if (diffDays <= 30) {
    bg = "bg-amber-100";
    fg = "text-amber-800";
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${bg} ${fg} ${className}`}
      title={`${expiry} 까지`}
    >
      {expiry} (D-{diffDays})
    </span>
  );
}
