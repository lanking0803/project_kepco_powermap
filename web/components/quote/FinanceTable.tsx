"use client";

/**
 * 5단계 수지분석 — 봉남리 PDF 양식 그대로의 20년 시계열 표.
 *
 * 컬럼 (자기자본 9개 / 대출 12개):
 *   구분 / 연간발전량 / SMP / REC / 총수익 / 유지보수 / 순수익 / 月평균 / 누적
 *   (대출 시) + 평균상환액(年) / 대출후 순익 / 대출후 누적
 *
 * 좌측 패널 좁아서 가로 스크롤. 구분 컬럼은 sticky.
 */

import type { FinanceResult, LoanScenario } from "@/lib/quote/finance";

interface Props {
  result: FinanceResult;
  scenario: LoanScenario;
}

export default function FinanceTable({ result, scenario }: Props) {
  const isLoan = scenario !== "자기자본";

  const cellRight =
    "px-2.5 py-1.5 text-right tabular-nums border-b border-gray-200 whitespace-nowrap text-gray-800";
  const headRight = `${cellRight} bg-gray-100 font-semibold !text-gray-700 border-b-gray-300`;
  const headLeftSticky =
    "sticky left-0 z-10 px-2.5 py-1.5 text-left bg-gray-100 font-semibold text-gray-700 border-b border-b-gray-300 whitespace-nowrap";
  const cellLeftSticky =
    "sticky left-0 z-10 px-2.5 py-1.5 text-left font-semibold text-gray-900 border-b border-gray-200 whitespace-nowrap";

  return (
    <div className="overflow-x-auto bg-white border border-gray-200 rounded">
      <table className="text-xs tabular-nums border-collapse min-w-full">
        <thead>
          <tr>
            <th className={headLeftSticky}>구분</th>
            <th className={headRight}>발전량(kWh)</th>
            <th className={headRight}>SMP</th>
            <th className={headRight}>REC</th>
            <th className={headRight}>총수익</th>
            <th className={headRight}>유지보수</th>
            <th className={headRight}>순수익</th>
            <th className={headRight}>月 평균</th>
            <th className={headRight}>누적</th>
            {isLoan && (
              <>
                <th className={headRight}>상환(年)</th>
                <th className={headRight}>대출후 순익</th>
                <th className={headRight}>대출후 누적</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r, i) => {
            const zebra = i % 2 === 1 ? "bg-gray-50" : "bg-white";
            return (
              <tr key={r.year} className={zebra}>
                <td className={`${cellLeftSticky} ${zebra}`}>{r.year}년</td>
                <td className={cellRight}>
                  {Math.round(r.generationKwh).toLocaleString()}
                </td>
                <td className={cellRight}>
                  {Math.round(r.smpIncome).toLocaleString()}
                </td>
                <td className={cellRight}>
                  {Math.round(r.recIncome).toLocaleString()}
                </td>
                <td className={cellRight}>
                  {Math.round(r.totalIncome).toLocaleString()}
                </td>
                <td className={`${cellRight} text-rose-600`}>
                  -{Math.round(r.maintenance).toLocaleString()}
                </td>
                <td className={`${cellRight} font-semibold text-gray-900`}>
                  {Math.round(r.netIncome).toLocaleString()}
                </td>
                <td className={`${cellRight} text-gray-600`}>
                  {Math.round(r.netIncome / 12).toLocaleString()}
                </td>
                <td className={`${cellRight} text-blue-700 font-semibold`}>
                  {Math.round(r.cumulativeNet).toLocaleString()}
                </td>
                {isLoan && (
                  <>
                    <td className={`${cellRight} text-rose-700`}>
                      {Math.round(r.loanPayment).toLocaleString()}
                    </td>
                    <td className={`${cellRight} font-semibold`}>
                      {Math.round(r.netAfterLoan).toLocaleString()}
                    </td>
                    <td className={`${cellRight} text-blue-700 font-semibold`}>
                      {Math.round(r.cumulativeAfterLoan).toLocaleString()}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
