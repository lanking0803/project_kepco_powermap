"use client";

/**
 * 가격 탭 메인 차트 — 월별 평당가 추이 + IQR 분포 + 거래 건수.
 *
 * 영업담당자가 한눈에 봐야 할 정보 4종을 단일 SVG 에 통합:
 *   - 꺽은선 (메인)     : 월별 평당가 중앙값 (시간 추이)
 *   - 음영 영역 (IQR)   : 그 달 가격 분포의 가운데 50% (협상 룸)
 *   - 배경 막대 (옅음)  : 그 달 거래 건수 (유동성)
 *   - 점 + hover 툴팁   : 월·평당가·건수·IQR 레인지
 *
 * 표준편차 대신 IQR 사용 — 토지/건물 거래는 outlier 영향이 커서 σ 가 왜곡됨.
 *
 * 데이터 0건 월:
 *   - 라인은 끊지 않고 마지막 유효 점에서 다음 유효 점으로 dotted 회색 보간
 *   - 점은 그리지 않음 (정직한 표현)
 *
 * Y축 (좌) = 평당가 (만원/평) · max/min 라벨만
 * Y축 (우) = 거래 건수 · max 라벨만
 * X축     = 첫 달 / 마지막 달만
 */

import type { MonthlyStat } from "@/lib/rtms/trade-stats";

interface Props {
  monthly: MonthlyStat[];
  /** "YYYY-MM" → 표시용 짧은 라벨 */
  formatYm: (ym: string) => string;
}

export default function PriceTrendChart({ monthly, formatYm }: Props) {
  if (monthly.length === 0) return null;

  const W = 100;
  const H = 50;
  const padTop = 2;
  const padBottom = 2;
  const padX = 2;
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;
  const stepX = monthly.length > 1 ? innerW / (monthly.length - 1) : innerW;

  // 가격 축 범위 — IQR/median 모두 포함
  const priceValues: number[] = [];
  for (const m of monthly) {
    if (m.median != null) priceValues.push(m.median);
    if (m.q1 != null) priceValues.push(m.q1);
    if (m.q3 != null) priceValues.push(m.q3);
  }
  const hasPriceData = priceValues.length > 0;
  const priceMax = hasPriceData ? Math.max(...priceValues) : 1;
  const priceMin = hasPriceData ? Math.min(...priceValues) : 0;
  const priceRange = Math.max(1, priceMax - priceMin);

  // 건수 축 범위 (배경 막대용)
  const countMax = Math.max(1, ...monthly.map((m) => m.count));

  const yPrice = (price: number) => {
    const ratio = (price - priceMin) / priceRange;
    return H - padBottom - ratio * innerH;
  };
  const yCount = (count: number) => {
    const ratio = count / countMax;
    return H - padBottom - ratio * innerH;
  };

  // 좌표 계산 — 가격 데이터 있는 점만 (라인용)
  const pricePoints = monthly.map((m, i) => ({
    ym: m.ym,
    x: padX + i * stepX,
    y: m.median != null ? yPrice(m.median) : null,
    yQ1: m.q1 != null ? yPrice(m.q1) : null,
    yQ3: m.q3 != null ? yPrice(m.q3) : null,
    count: m.count,
    median: m.median,
    q1: m.q1,
    q3: m.q3,
  }));

  // 라인 path — null 구간은 끊고 다시 시작
  const segments: { d: string; dotted: boolean }[] = [];
  let currentD = "";
  let prevX: number | null = null;
  let prevY: number | null = null;
  for (const p of pricePoints) {
    if (p.y != null) {
      if (prevX != null && prevY != null && currentD === "") {
        // 갭 후 첫 유효 점 — 이전 유효 점에서 dotted 보간
        segments.push({
          d: `M${prevX.toFixed(2)},${prevY.toFixed(2)} L${p.x.toFixed(2)},${p.y.toFixed(2)}`,
          dotted: true,
        });
      }
      currentD += currentD === "" ? `M${p.x.toFixed(2)},${p.y.toFixed(2)}` : ` L${p.x.toFixed(2)},${p.y.toFixed(2)}`;
      prevX = p.x;
      prevY = p.y;
    } else if (currentD !== "") {
      segments.push({ d: currentD, dotted: false });
      currentD = "";
    }
  }
  if (currentD !== "") segments.push({ d: currentD, dotted: false });

  // IQR 영역 path — 연속 구간만. 갭이 있으면 path 분리.
  const iqrPaths: string[] = [];
  let iqrTop: { x: number; y: number }[] = [];
  let iqrBot: { x: number; y: number }[] = [];
  for (const p of pricePoints) {
    if (p.yQ3 != null && p.yQ1 != null) {
      iqrTop.push({ x: p.x, y: p.yQ3 });
      iqrBot.push({ x: p.x, y: p.yQ1 });
    } else if (iqrTop.length > 0) {
      iqrPaths.push(buildAreaPath(iqrTop, iqrBot));
      iqrTop = [];
      iqrBot = [];
    }
  }
  if (iqrTop.length > 0) iqrPaths.push(buildAreaPath(iqrTop, iqrBot));

  // 마지막 유효 점 (강조용)
  const lastValid = [...pricePoints].reverse().find((p) => p.y != null);

  return (
    <div className="w-full">
      {/* Y축 라벨 (좌측: 가격, 우측: 건수) + 차트 본체 */}
      <div className="flex items-stretch gap-1.5">
        {/* 좌: 평당가 max/min */}
        <div className="flex flex-col justify-between text-[9px] text-blue-700 tabular-nums font-semibold leading-none py-0.5 w-9 text-right select-none">
          <span title="기간 내 최고 평당가">
            {hasPriceData ? formatManPyeong(priceMax) : "—"}
          </span>
          <span title="기간 내 최저 평당가" className="text-gray-400">
            {hasPriceData ? formatManPyeong(priceMin) : "—"}
          </span>
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-32 block"
          preserveAspectRatio="none"
        >
          <defs>
            {/* IQR 그라데이션 (옅게) */}
            <linearGradient id="iqr-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.08" />
            </linearGradient>
          </defs>

          {/* 1. 배경 막대 (거래 건수) — 가장 옅음 */}
          {pricePoints.map((p) => {
            if (p.count === 0) return null;
            const barH = H - padBottom - yCount(p.count);
            const barW = Math.max(0.8, stepX * 0.55);
            return (
              <rect
                key={`bar-${p.ym}`}
                x={p.x - barW / 2}
                y={yCount(p.count)}
                width={barW}
                height={barH}
                fill="#cbd5e1"
                opacity="0.45"
              />
            );
          })}

          {/* 2. IQR 음영 영역 */}
          {iqrPaths.map((d, i) => (
            <path key={`iqr-${i}`} d={d} fill="url(#iqr-grad)" />
          ))}

          {/* 3. 메인 라인 (월별 평당가 중앙값) */}
          {segments.map((s, i) => (
            <path
              key={`seg-${i}`}
              d={s.d}
              fill="none"
              stroke={s.dotted ? "#94a3b8" : "#2563eb"}
              strokeWidth={s.dotted ? "0.8" : "1.4"}
              strokeDasharray={s.dotted ? "1.2 1.2" : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* 4. 점 + hover 툴팁 */}
          {pricePoints.map((p) => {
            if (p.y == null) return null;
            const isLast = lastValid != null && p.ym === lastValid.ym;
            return (
              <g key={`pt-${p.ym}`}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isLast ? 1.8 : 1.2}
                  fill="#2563eb"
                  stroke="white"
                  strokeWidth="0.6"
                  vectorEffect="non-scaling-stroke"
                />
                {/* hover 영역 확장 (점이 작아 툴팁 잡기 어려운 거 보완) */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="3"
                  fill="transparent"
                  style={{ cursor: "default" }}
                >
                  <title>{buildTooltip(p, formatYm)}</title>
                </circle>
              </g>
            );
          })}

          {/* 5. 마지막 점 외곽 강조 (현재 시점) */}
          {lastValid && lastValid.y != null && (
            <circle
              cx={lastValid.x}
              cy={lastValid.y}
              r="2.8"
              fill="none"
              stroke="#2563eb"
              strokeWidth="0.6"
              strokeOpacity="0.45"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}
        </svg>

        {/* 우: 건수 max */}
        <div className="flex flex-col justify-between text-[9px] text-gray-500 tabular-nums font-semibold leading-none py-0.5 w-7 select-none">
          <span title="월간 최대 거래 건수">{countMax}건</span>
          <span className="text-gray-300">0</span>
        </div>
      </div>

      {/* X축 라벨 + 범례 */}
      <div className="flex justify-between items-center text-[10px] text-gray-500 mt-1 tabular-nums font-medium pl-10 pr-8">
        <span>{formatYm(monthly[0].ym)}</span>
        <span className="flex items-center gap-2 text-[10px] text-gray-500">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-0.5 bg-blue-600 rounded" />
            평당가
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 bg-blue-300 opacity-60 rounded-sm" />
            분포
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 bg-slate-300 opacity-70 rounded-sm" />
            건수
          </span>
        </span>
        <span>{formatYm(monthly[monthly.length - 1].ym)}</span>
      </div>
    </div>
  );
}

function buildAreaPath(
  top: ReadonlyArray<{ x: number; y: number }>,
  bot: ReadonlyArray<{ x: number; y: number }>,
): string {
  if (top.length === 0) return "";
  const topPath = top
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
  const botPath = [...bot]
    .reverse()
    .map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
  return `${topPath} ${botPath} Z`;
}

function buildTooltip(
  p: {
    ym: string;
    count: number;
    median: number | null;
    q1: number | null;
    q3: number | null;
  },
  formatYm: (ym: string) => string,
): string {
  const parts = [`${formatYm(p.ym)} · ${p.count}건`];
  if (p.median != null) {
    parts.push(`평당 ${formatManPyeong(p.median)}`);
  }
  if (p.q1 != null && p.q3 != null) {
    parts.push(`레인지 ${formatManPyeong(p.q1)}~${formatManPyeong(p.q3)}`);
  }
  return parts.join(" · ");
}

/** 평당가(원/평) → "₩123만/평" 포맷. 천단위는 만 단위 그대로 */
function formatManPyeong(pricePerPyeong: number): string {
  return `₩${Math.round(pricePerPyeong / 10000).toLocaleString()}만`;
}
