"use client";

/**
 * 가격 탭 메인 차트 — 월별 평당가 추이 + IQR 분포 + 거래 건수 (Recharts).
 *
 * 단일 ComposedChart 안에 4정보 통합:
 *   - 라인 (메인)       : 월별 평당가 중앙값 (좌측 Y축)
 *   - 영역 (IQR)        : Q1~Q3 분포 (협상 룸, 좌측 Y축)
 *   - 막대 (옅음)       : 거래 건수 (우측 Y축)
 *   - Tooltip 자동      : 점 hover 시 즉시 표시
 *
 * 표준편차 대신 IQR 사용 — 토지/건물 거래는 outlier 영향이 커서 σ 가 왜곡됨.
 *
 * 데이터 0건 월:
 *   - median/q1/q3 가 null 인 행은 Recharts 가 자동으로 라인 끊고 보간 안 함
 *   - 막대(count)는 0 으로 그대로 표기
 */

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonthlyStat } from "@/lib/rtms/trade-stats";

interface Props {
  monthly: MonthlyStat[];
  /** "YYYY-MM" → 표시용 짧은 라벨 */
  formatYm: (ym: string) => string;
}

interface ChartRow {
  ym: string;
  ymLabel: string;
  median: number | null;
  // Recharts Area 는 [low, high] 튜플로 밴드 그림
  iqr: [number, number] | null;
  count: number;
}

export default function PriceTrendChart({ monthly, formatYm }: Props) {
  if (monthly.length === 0) return null;

  const data: ChartRow[] = monthly.map((m) => ({
    ym: m.ym,
    ymLabel: formatYm(m.ym),
    median: m.median != null ? Math.round(m.median / 10000) : null,
    iqr:
      m.q1 != null && m.q3 != null
        ? [Math.round(m.q1 / 10000), Math.round(m.q3 / 10000)]
        : null,
    count: m.count,
  }));

  return (
    // 명시적 width 100% — flex 부모(공매탭 PriceCard) 안에서 -1 으로 찌부러지는 거 방지
    <div style={{ width: "100%", height: 176 }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
        >
          <CartesianGrid stroke="#f1f5f9" vertical={false} />

          <XAxis
            dataKey="ymLabel"
            tick={{ fontSize: 10, fill: "#64748b" }}
            tickLine={false}
            axisLine={{ stroke: "#e2e8f0" }}
            interval="preserveStartEnd"
            minTickGap={30}
          />

          {/* 좌: 평당가 (만원/평) */}
          <YAxis
            yAxisId="price"
            tick={{ fontSize: 10, fill: "#2563eb" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `₩${v}만`}
            width={48}
          />

          {/* 우: 거래 건수 */}
          <YAxis
            yAxisId="count"
            orientation="right"
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}건`}
            width={36}
            allowDecimals={false}
          />

          <Tooltip content={<ChartTooltip />} />

          {/* 1. 거래 건수 막대 (배경, 옅게) */}
          <Bar
            yAxisId="count"
            dataKey="count"
            fill="#cbd5e1"
            opacity={0.55}
            barSize={18}
            radius={[2, 2, 0, 0]}
          />

          {/* 2. IQR 음영 (Q1~Q3 분포) */}
          <Area
            yAxisId="price"
            dataKey="iqr"
            fill="#3b82f6"
            fillOpacity={0.18}
            stroke="none"
            isAnimationActive={false}
            connectNulls={false}
          />

          {/* 3. 메인 라인 (월별 평당가 중앙값) */}
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="median"
            stroke="#2563eb"
            strokeWidth={2}
            dot={{ r: 3.5, fill: "#2563eb", stroke: "white", strokeWidth: 1.5 }}
            activeDot={{ r: 5, fill: "#1d4ed8", stroke: "white", strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * 점 hover 시 표시되는 툴팁 카드.
 * Recharts payload 에서 우리가 넣은 ChartRow 의 원본 값 추출.
 */
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;

  return (
    <div className="bg-gray-900 text-white rounded-md shadow-lg px-2.5 py-2 text-[11px] tabular-nums leading-tight whitespace-nowrap">
      <div className="font-bold mb-1 text-blue-200">{label ?? row.ymLabel}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-gray-400 w-9">평당가</span>
        <span className="font-bold text-base">
          {row.median != null ? `₩${row.median.toLocaleString()}만` : "—"}
        </span>
      </div>
      {row.iqr && (
        <div className="flex items-baseline gap-1.5 mt-0.5">
          <span className="text-gray-400 w-9">분포</span>
          <span className="text-gray-200">
            ₩{row.iqr[0].toLocaleString()}만 ~ ₩{row.iqr[1].toLocaleString()}만
          </span>
        </div>
      )}
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="text-gray-400 w-9">거래</span>
        <span className="text-gray-200 font-semibold">{row.count}건</span>
      </div>
    </div>
  );
}
