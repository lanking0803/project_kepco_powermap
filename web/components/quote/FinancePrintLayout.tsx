"use client";

/**
 * 수익 분석 (5단계) 인쇄 양식 — 봉남리 견적서 PDF A3 가로 그대로.
 *
 * 헤더: "RPS 태양광 경제성 분석 (현물시장) 모듈명"
 * 좌측 큰 표 = 20년 시계열 (12 컬럼)
 * 우측 4 박스:
 *   1. 태양광발전사업 세부내용 << 양면모듈 >>
 *   2. ♦ 태양광 설치비용 ♦
 *   3. ♦ 태양광 대출비용 ♦
 *   4. ♦ 태양광 최종수익 ♦
 * 하단: 면책 문구
 */

import type { FinancePrintData } from "@/lib/quote/print-data";

interface Props {
  data: FinancePrintData;
}

const formatWon = (n: number) =>
  `₩ ${Math.round(n).toLocaleString()}`;

/** ISO → "2026년 4월 28일" */
const formatGenDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
};

export default function FinancePrintLayout({ data }: Props) {
  const isLoan = data.scenario !== "자기자본";
  const totalAfterLoanLabel = isLoan
    ? formatWon(data.totalAfterLoan)
    : formatWon(data.totalNetIncome);
  const scenarioLabel =
    data.scenario === "자기자본"
      ? "자기자본 100%"
      : `${data.scenario} 대출`;
  // 대출액 % = loanPrincipal / totalCost (총사업비 기준)
  const loanPct =
    data.totalCost > 0 && data.loanPrincipal > 0
      ? (data.loanPrincipal / data.totalCost) * 100
      : 0;

  return (
    <div className="finance-print-layout">
      {/* 헤더 — 봉남리 양식 + 시나리오 명시 */}
      <h1 className="title">
        RPS 태양광 경제성 분석 (현물시장) {data.module.name}
        <span className="scenario-badge">{scenarioLabel}</span>
      </h1>

      <div className="body">
        {/* 좌측 — 20년 시계열 표 */}
        <div className="table-region">
          <table className="finance-table">
            <thead>
              <tr>
                <th rowSpan={2}>구분</th>
                <th rowSpan={2}>
                  연간 발전량
                  <br />
                  (kW)
                </th>
                <th rowSpan={2}>
                  한국전력
                  <br />
                  매전금액수익
                  <br />
                  (SMP)
                </th>
                <th rowSpan={2}>
                  공급인증서
                  <br />
                  수익
                  <br />
                  (REC)
                </th>
                <th rowSpan={2}>
                  총수익
                  <br />
                  (SMP+REC)
                </th>
                <th rowSpan={2}>
                  유지보수비용
                  <br />
                  (年매출의 3%)
                </th>
                <th rowSpan={2}>
                  총수익 - 유지보수
                </th>
                <th rowSpan={2}>
                  평균예상수익
                  <br />
                  (月)
                </th>
                <th rowSpan={2}>
                  누적수익(年)
                </th>
                <th rowSpan={2}>
                  평균 상환액
                  <br />
                  (年)
                </th>
                <th rowSpan={2}>
                  평균수익(年)
                  <br />
                  (대출후)
                </th>
                <th rowSpan={2}>
                  누적수익(年)
                  <br />
                  (대출후)
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.year}>
                  <td className="year">{r.year}년</td>
                  <td className="num">{Math.round(r.generationKwh).toLocaleString()}</td>
                  <td className="num">{Math.round(r.smpIncome).toLocaleString()}</td>
                  <td className="num">{Math.round(r.recIncome).toLocaleString()}</td>
                  <td className="num">{Math.round(r.totalIncome).toLocaleString()}</td>
                  <td className="num">{Math.round(r.maintenance).toLocaleString()}</td>
                  <td className="num highlight">
                    ₩ {Math.round(r.netIncome).toLocaleString()}
                  </td>
                  <td className="num">{Math.round(r.netIncome / 12).toLocaleString()}</td>
                  <td className="num cum">{Math.round(r.cumulativeNet).toLocaleString()}</td>
                  <td className="num">
                    {isLoan && r.loanPayment > 0
                      ? Math.round(r.loanPayment).toLocaleString()
                      : "-"}
                  </td>
                  <td className="num">
                    {isLoan ? Math.round(r.netAfterLoan).toLocaleString() : "-"}
                  </td>
                  <td className="num cum">
                    {isLoan
                      ? Math.round(r.cumulativeAfterLoan).toLocaleString()
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* 면책 문구 + 출력일 */}
          <div className="disclaimer">
            <div># 이 수지분석은 2024년 현물시장 기준 수익분석 자료입니다.</div>
            <div># 선로 개통비 , 구조 보강비 별도 / 순 공사비 기준 수익분석 자료 입니다.</div>
            <div className="meta-row">
              <span>출력일: {formatGenDate(data.generatedAt)}</span>
            </div>
          </div>
        </div>

        {/* 우측 — 4 박스 */}
        <aside className="info-region">
          {/* ① 태양광발전사업 세부내용 — 영업 정보 추가 (부지/동수/평수) */}
          <div className="info-box">
            <div className="box-title">
              태양광발전사업 세부내용
              <br />
              <span className="subtitle">&lt;&lt; 양면모듈 &gt;&gt;</span>
            </div>
            <KV label="사업 부지" value={data.address} small />
            <KV
              label="설치 영역"
              value={`${data.buildingCount}동 · ${data.totalPyeong.toLocaleString()}평`}
            />
            <KV label="발전설비용량 (kW)" value={data.totalKw.toFixed(2)} />
            <KV label="총 모듈 장수" value={`${data.totalPanels.toLocaleString()}장`} />
            <KV label="발전시간 (일간 평균)" value={data.dailyHours.toFixed(1)} />
            <KV label="한전전력매전금액 (SMP)" value={data.smpPrice.toFixed(1)} />
            <KV label="공급인증서 (REC)" value={data.recPrice.toFixed(1)} />
            <KV label="가중치" value={data.recWeight.toFixed(1)} />
          </div>

          {/* ② 태양광 설치비용 */}
          <div className="info-box red-box">
            <div className="box-title red-title">♦ 태양광 설치비용 ♦</div>
            <KV label="공사금액" value={formatWon(data.constructionCost)} />
            <KV label="부가세" value={formatWon(data.vat)} />
            <KV
              label="◆총 사업비◆"
              value={formatWon(data.totalCost)}
              emphasize
            />
          </div>

          {/* ③ 태양광 대출비용 — 대출액에 총사업비 % 같이 표기 (영업 일관성) */}
          <div className="info-box red-box">
            <div className="box-title red-title">♦ 태양광 대출비용 ♦</div>
            <KV
              label="대출액"
              value={
                data.loanPrincipal > 0
                  ? `${formatWon(data.loanPrincipal)} (총사업비의 ${loanPct.toFixed(0)}%)`
                  : "0원 (자기자본)"
              }
            />
            <KV
              label="년이율 (%)"
              value={`${(data.loanRate * 100).toFixed(2)}%`}
            />
            <KV
              label="상환기간"
              value={data.repayMonths > 0 ? `${data.repayMonths}(月)` : "-"}
            />
            <KV
              label="거치기간"
              value={isLoan ? `${data.graceMonths}(月)` : "-"}
            />
            {isLoan && (
              <div className="loan-note">
                거치 후 원리금 균등상환 ·{" "}
                <b>
                  총 {Math.round((data.graceMonths + data.repayMonths) / 12)}년
                </b>{" "}
                걸쳐 갚음
              </div>
            )}
          </div>

          {/* ④ 태양광 최종수익 */}
          <div className="info-box red-box">
            <div className="box-title red-title">♦ 태양광 최종수익 ♦</div>
            <KV
              label="ROI (투자자본수익률)"
              value={`${(data.roi * 100).toFixed(1)}%`}
            />
            <KV
              label="손익분기점 (년)"
              value={
                data.paybackYears == null
                  ? "20년+"
                  : `${data.paybackYears.toFixed(1)}(년)`
              }
            />
            <KV
              label="20년 총수익 (無대출)"
              value={formatWon(data.totalNetIncome)}
              emphasize
            />
            <KV
              label="20년 총수익 (대출적용)"
              value={totalAfterLoanLabel}
              emphasize
            />
          </div>
        </aside>
      </div>

      <style jsx>{`
        .finance-print-layout {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          font-family: "Malgun Gothic", "맑은 고딕", system-ui, sans-serif;
          color: #111;
        }
        .title {
          position: relative;
          margin: 0 0 3mm 0;
          padding: 2mm;
          border: 1.5px solid #c00;
          background: #fee;
          font-size: 14pt;
          font-weight: 700;
          text-align: center;
          color: #c00;
        }
        .scenario-badge {
          position: absolute;
          right: 4mm;
          top: 50%;
          transform: translateY(-50%);
          font-size: 10pt;
          font-weight: 600;
          padding: 1mm 3mm;
          background: white;
          border: 1px solid #c00;
          border-radius: 3mm;
        }
        .body {
          flex: 1;
          display: grid;
          grid-template-columns: 7fr 3fr;
          gap: 3mm;
          min-height: 0;
        }
        .table-region {
          display: flex;
          flex-direction: column;
          gap: 2mm;
        }
        .finance-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 6.5pt;
          tabular-nums: 1;
        }
        .finance-table th,
        .finance-table td {
          border: 1px solid #888;
          padding: 0.8mm 1.2mm;
        }
        .finance-table thead th {
          background: #cfe2f3;
          color: #1f4e79;
          font-weight: 700;
          font-size: 6pt;
          text-align: center;
          line-height: 1.1;
        }
        .finance-table .year {
          text-align: center;
          font-weight: 600;
        }
        .finance-table .num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        .finance-table .highlight {
          background: #fff2cc;
          font-weight: 700;
        }
        .finance-table .cum {
          color: #1f4e79;
          font-weight: 600;
        }
        .disclaimer {
          font-size: 7pt;
          color: #555;
          line-height: 1.3;
          background: #fff;
          padding: 1mm 2mm;
          border: 1px solid #ddd;
          border-radius: 1mm;
        }
        .meta-row {
          display: flex;
          justify-content: flex-start;
          align-items: baseline;
          gap: 4mm;
          margin-top: 1.5mm;
          padding-top: 1.5mm;
          border-top: 1px dashed #ccc;
          font-size: 6.5pt;
          color: #555;
        }
        .info-region {
          display: flex;
          flex-direction: column;
          gap: 2mm;
          font-size: 7.5pt;
        }
        .info-box {
          border: 1px solid #555;
        }
        .red-box {
          border: 1.5px solid #c00;
        }
        .box-title {
          background: #fff;
          padding: 1.5mm 2mm;
          font-size: 8.5pt;
          font-weight: 700;
          text-align: center;
          border-bottom: 1px solid #555;
        }
        .subtitle {
          font-size: 7.5pt;
          color: #555;
        }
        .red-title {
          background: #fee;
          color: #c00;
          border-bottom: 1.5px solid #c00;
        }
        .loan-note {
          padding: 1mm 2mm;
          font-size: 6.5pt;
          color: #555;
          background: #fff;
          border-top: 1px dashed #ccc;
          line-height: 1.3;
        }
        .loan-note b {
          color: #c00;
        }
      `}</style>
    </div>
  );
}

/** 박스 안 라벨/값 한 줄. small 은 긴 주소 등 와이드 텍스트용 (라벨 위 / 값 아래) */
function KV({
  label,
  value,
  emphasize,
  small,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  small?: boolean;
}) {
  return (
    <div
      className={`kv ${emphasize ? "kv-emph" : ""} ${small ? "kv-stack" : ""}`}
    >
      <span className="kv-label">{label}</span>
      <span className="kv-value">{value}</span>
      <style jsx>{`
        .kv {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          padding: 1mm 2mm;
          border-bottom: 1px dotted #ccc;
          font-size: 7.5pt;
        }
        .kv:last-child {
          border-bottom: none;
        }
        .kv-label {
          color: #444;
        }
        .kv-value {
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          color: #111;
          text-align: right;
        }
        .kv-emph .kv-label,
        .kv-emph .kv-value {
          color: #c00;
          font-weight: 700;
          font-size: 8pt;
        }
        .kv-stack {
          flex-direction: column;
          align-items: flex-start;
          gap: 0.5mm;
        }
        .kv-stack .kv-value {
          text-align: left;
          font-size: 7pt;
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}
