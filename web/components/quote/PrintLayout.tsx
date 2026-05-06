"use client";

/**
 * 도면 출력 (3단계) 인쇄 양식 — 봉남리 PDF A3 가로 그대로.
 *
 * 좌측 70% = 카카오맵 위성 + 패널 + 라벨 + 나침반 (P4 에서 PrintMap 으로 교체)
 * 우측 30% = 발전설비 개요 / 모듈 / 변전소 여유 / 회사 정보
 *
 * 의뢰자 양식 일관 — © kakao 로고 + "현장 여건에 따라 변경" 면책 그대로.
 */

import { useState } from "react";
import type { BlueprintPrintData } from "@/lib/quote/print-data";
import { COMPANY, COMPANY_LOGO_PATH } from "@/lib/quote/company";

const M2_TO_PYEONG = 0.3025;

/** ISO → "2026-04-28" (도면 Date 칸용 — 짧고 정렬된 형식) */
function formatPrintDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface Props {
  data: BlueprintPrintData;
  /** 인쇄 페이지의 카카오맵 영역 — P4 에서 PrintMap 컴포넌트로 채움 */
  mapSlot?: React.ReactNode;
}

export default function PrintLayout({ data, mapSlot }: Props) {
  const totalPanels = data.buildings.reduce((s, b) => s + b.panelCount, 0);
  const totalKw = data.buildings.reduce((s, b) => s + b.kwActual, 0);

  return (
    <div className="print-layout">
      {/* 좌측 = 위성 + 패널 (P4 에서 카카오맵 SDK 인스턴스로 채움) */}
      <div className="map-region">
        {mapSlot ?? (
          <div className="map-placeholder">
            카카오맵 영역 (Step P4 에서 채움)
          </div>
        )}
        {/* 좌하단 도면명 */}
        <div className="map-title">전 체 배 치 도</div>
      </div>

      {/* 우측 = 정보 패널 */}
      <aside className="info-panel">
        {/* 1. 발전설비 개요 — 사업 부지에 지목 · 평수 같이 (영업 친절도) */}
        <Section title="발전설비 개요 - 태양광 발전설비">
          <ol className="overview-list">
            <li>
              1. 사업 부지 : {data.address}
              {(() => {
                const parcelPyeong = Math.round(data.parcelM2 * M2_TO_PYEONG);
                const extras = [
                  data.jimok,
                  `${parcelPyeong.toLocaleString()}평`,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return extras ? (
                  <span className="parcel-extras"> ({extras})</span>
                ) : null;
              })()}
            </li>
            <li>
              2. 설치 모듈 : {data.module.name} ({data.module.widthMm.toLocaleString()}{" "}
              x {data.module.heightMm.toLocaleString()} x {data.module.thicknessMm})
            </li>
            <li>
              3. 총 설치 모듈 장수 : {totalPanels.toLocaleString()}[장]
            </li>
            <li>
              4. 총 시설용량 : {data.module.watt}[Wp] x{" "}
              {totalPanels.toLocaleString()}[장] = {totalKw.toFixed(3)}kW
            </li>
            <li>5. 태양 고도각 : {data.solarAltitudeDeg}도</li>
            <li>6. 구조물 형식 : 고정식</li>
          </ol>
          <div className="disclaimer">
            * 현장 여건에 따라 배치 및 용량은 변경 될 수 있음.
          </div>
        </Section>

        {/* 2. MODULE 표 — 동별 수량/용량 */}
        <Section title={null}>
          <table className="module-table">
            <thead>
              <tr>
                <th rowSpan={2}>MODULE</th>
                <th colSpan={2}>{data.module.name.replace(/Wp?$/i, "W")}</th>
              </tr>
              <tr>
                <th>수량(장)</th>
                <th>용량[KW]</th>
              </tr>
            </thead>
            <tbody>
              {data.buildings.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td className="num">{b.panelCount.toLocaleString()}</td>
                  <td className="num">{b.kwActual.toFixed(3)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td>총 발전용량</td>
                <td className="num">{totalPanels.toLocaleString()}</td>
                <td className="num">{totalKw.toFixed(3)}</td>
              </tr>
            </tbody>
          </table>
        </Section>

        {/* 3. 변전소 여유선로 — KEPCO 데이터. 음수면 빨간 강조 + 초과 표기 */}
        {data.kepco && (
          <Section title={null}>
            <table className="kepco-table">
              <thead>
                <tr>
                  <th>구분</th>
                  <th>여유용량[MW]</th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    label: "변전소",
                    detail: data.kepco.substationName,
                    freeMW: data.kepco.substationFreeMW,
                  },
                  {
                    label: "주변압기",
                    detail: data.kepco.mtrName,
                    freeMW: data.kepco.mtrFreeMW,
                  },
                  {
                    label: "배전선로",
                    detail: data.kepco.dlName,
                    freeMW: data.kepco.dlFreeMW,
                  },
                ].map((row) => {
                  const isOver = row.freeMW < 0;
                  return (
                    <tr key={row.label}>
                      <td>
                        <b>{row.label}</b> {row.detail}
                      </td>
                      <td
                        className="num"
                        style={
                          isOver ? { color: "#c00", fontWeight: 700 } : undefined
                        }
                      >
                        {isOver
                          ? `초과 ${Math.abs(row.freeMW).toFixed(1)}`
                          : row.freeMW.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
                <tr className="checked-at">
                  <td colSpan={2}>{data.kepco.checkedAt}</td>
                </tr>
              </tbody>
            </table>
          </Section>
        )}

        {/* 4. 회사 로고 + 회사 정보 박스 — 영업사원 자필/명함 부착용 빈 양식 */}
        <div className="company-box">
          <CompanyLogo />
          <div className="company-info">
            <div className="company-detail">
              주 소 :
              <br />
              전 화 :
              <br />
              모바일 :
              <br />
              팩 스 :
              <br />
              이메일 :
              <br />
              홈페이지 :
            </div>
          </div>
        </div>

        {/* 5. 도면 메타 — Date/Drawing Title 자동 채움 (나머지는 의뢰자 직접 기입) */}
        <table className="drawing-meta">
          <tbody>
            <tr>
              <td className="label">Drawing By 제 도</td>
              <td className="blank" />
            </tr>
            <tr>
              <td className="label">Design By 설 계</td>
              <td className="blank" />
            </tr>
            <tr>
              <td className="label">Approved By 승 인</td>
              <td className="blank" />
            </tr>
            <tr>
              <td className="label">Date 날 짜</td>
              <td className="filled">{formatPrintDate(data.generatedAt)}</td>
            </tr>
            <tr>
              <td className="label">Project Title 공 사 명</td>
              <td className="blank" />
            </tr>
            <tr>
              <td className="label">Drawing Title 도 면 명</td>
              <td className="filled">전체 배치도</td>
            </tr>
            <tr>
              <td className="label">Scale 축 척</td>
              <td className="blank" />
            </tr>
            <tr>
              <td className="label">Drawing No</td>
              <td className="blank" />
            </tr>
          </tbody>
        </table>
      </aside>

      {/* 인쇄 양식 CSS — 봉남리 PDF 그대로 재현 */}
      <style jsx>{`
        .print-layout {
          display: grid;
          grid-template-columns: 7fr 3fr;
          gap: 4mm;
          width: 100%;
          height: 100%;
          font-family: "Malgun Gothic", "맑은 고딕", system-ui, sans-serif;
          color: #111;
        }
        .map-region {
          position: relative;
          border: 1px solid #333;
          background: #f0f0f0;
          overflow: hidden;
        }
        .map-placeholder {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          color: #999;
          font-size: 12pt;
        }
        .map-title {
          position: absolute;
          left: 50%;
          bottom: 4mm;
          transform: translateX(-50%);
          font-size: 11pt;
          letter-spacing: 4pt;
          background: white;
          padding: 1mm 4mm;
          border: 1px solid #333;
        }
        .info-panel {
          display: flex;
          flex-direction: column;
          gap: 2mm;
          font-size: 8pt;
        }
        .section-title {
          background: #fff;
          border: 1px solid #333;
          padding: 1.5mm 2mm;
          font-weight: 700;
          font-size: 9pt;
          text-align: center;
        }
        .section-body {
          border: 1px solid #333;
          border-top: none;
          padding: 2mm;
        }
        .overview-list {
          margin: 0;
          padding: 0;
          list-style: none;
          line-height: 1.5;
        }
        .disclaimer {
          margin-top: 1.5mm;
          padding-top: 1.5mm;
          border-top: 1px dashed #999;
          color: #c00;
          font-size: 7.5pt;
        }
        .module-table,
        .kepco-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 8pt;
          table-layout: fixed;
        }
        .module-table th,
        .module-table td,
        .kepco-table th,
        .kepco-table td {
          border: 1px solid #555;
          padding: 1.2mm 2mm;
          text-align: center;
        }
        .kepco-table tbody td:first-child {
          text-align: left;
        }
        .module-table thead th,
        .kepco-table thead th {
          background: #fff;
          font-weight: 700;
        }
        .num {
          text-align: right !important;
          font-variant-numeric: tabular-nums;
        }
        .total-row td {
          font-weight: 700;
          background: #fff;
        }
        .checked-at td {
          font-size: 7pt;
          color: #555;
          text-align: center;
          background: #fff;
        }
        .company-box {
          display: flex;
          gap: 2mm;
          padding: 2mm;
          border: 1px solid #333;
          background: #fff;
        }
        .company-info {
          flex: 1;
          font-size: 7.5pt;
          line-height: 1.4;
        }
        .company-name-en {
          font-weight: 700;
          font-size: 9pt;
        }
        .company-name-ko {
          font-weight: 700;
          color: #006400;
          margin-bottom: 1mm;
        }
        .company-detail {
          color: #333;
        }
        .drawing-meta {
          width: 100%;
          border-collapse: collapse;
          font-size: 7.5pt;
        }
        .drawing-meta td {
          border: 1px solid #555;
          padding: 1mm 1.5mm;
          height: 5mm;
        }
        .drawing-meta .label {
          background: #fff;
          width: 35%;
          font-size: 7pt;
        }
        .drawing-meta .blank {
          background: white;
        }
        .drawing-meta .filled {
          background: white;
          font-variant-numeric: tabular-nums;
          color: #111;
          font-weight: 500;
        }
        .parcel-extras {
          color: #555;
          font-weight: normal;
        }
      `}</style>
    </div>
  );
}

// ── 보조 컴포넌트 ──────────────────────────

function Section({
  title,
  children,
}: {
  title: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="section">
      {title && <div className="section-title">{title}</div>}
      <div className={title ? "section-body" : ""}>{children}</div>
      <style jsx>{`
        .section {
          break-inside: avoid;
        }
        .section-title {
          background: #fff;
          border: 1px solid #333;
          padding: 1.5mm 2mm;
          font-weight: 700;
          font-size: 9pt;
          text-align: center;
        }
        .section-body {
          border: 1px solid #333;
          border-top: none;
          padding: 2mm;
        }
      `}</style>
    </div>
  );
}

/**
 * 회사 로고 — public/print/company-logo.png 가 없으면 placeholder.
 * 의뢰자가 추후 같은 경로에 PNG 두면 자동 표시.
 */
function CompanyLogo() {
  const [hasLogo, setHasLogo] = useState(true);
  return (
    <div className="logo-wrap">
      {hasLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={COMPANY_LOGO_PATH}
          alt={COMPANY.name}
          className="logo-img"
          onError={() => setHasLogo(false)}
        />
      ) : (
        <div className="logo-placeholder" aria-label="로고 영역">
          LOGO
        </div>
      )}
      <style jsx>{`
        .logo-wrap {
          width: 14mm;
          height: 14mm;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .logo-img {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }
        .logo-placeholder {
          width: 100%;
          height: 100%;
          border: 1px dashed #999;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 7pt;
          color: #999;
          background: #fff;
        }
      `}</style>
    </div>
  );
}
