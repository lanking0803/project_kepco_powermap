"use client";

/**
 * 인쇄 페이지 우상단 floating 버튼.
 * 화면에서만 노출 — 인쇄 미디어에서는 자동 숨김 (양식에 포함 X).
 *
 * 도면 PDF · 수익 분석 PDF 두 페이지에서 공유.
 */

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print-btn"
    >
      🖨 PDF로 인쇄
      <style jsx>{`
        .print-btn {
          position: fixed;
          top: 8mm;
          right: 8mm;
          z-index: 100;
          padding: 10px 16px;
          background: #2563eb;
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 12pt;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);
          font-family: "Malgun Gothic", "맑은 고딕", system-ui, sans-serif;
        }
        .print-btn:hover {
          background: #1d4ed8;
        }
        .print-btn:active {
          background: #1e40af;
        }
        @media print {
          .print-btn {
            display: none !important;
          }
        }
      `}</style>
    </button>
  );
}
