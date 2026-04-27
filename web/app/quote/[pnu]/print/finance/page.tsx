"use client";

/**
 * 수익 분석 (5단계) 인쇄 라우트 — A3 가로 봉남리 견적서 양식 1페이지.
 *
 * 흐름:
 *   1. 견적 모드 4단계(수익 분석) [💰 수익 분석 PDF 저장] 버튼 → sessionStorage 저장 → 새 탭
 *   2. 데이터 로드 → FinancePrintLayout 렌더
 *   3. DOM ready + 짧은 마진 후 window.print() 자동 호출
 */

import { use, useEffect, useState } from "react";
import FinancePrintLayout from "@/components/quote/FinancePrintLayout";
import PrintButton from "@/components/quote/PrintButton";
import {
  loadFinanceData,
  type FinancePrintData,
} from "@/lib/quote/print-data";

interface Props {
  params: Promise<{ pnu: string }>;
}

export default function FinancePrintPage({ params }: Props) {
  const { pnu } = use(params);
  const [data, setData] = useState<FinancePrintData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const printedRef = useRef(false);

  useEffect(() => {
    const loaded = loadFinanceData(pnu);
    if (!loaded) {
      setError(
        "인쇄 데이터를 찾을 수 없습니다. 견적 모드의 [💰 수익 분석 PDF 저장] 버튼으로 다시 진입해주세요.",
      );
      return;
    }
    setData(loaded);
  }, [pnu]);

  // 데이터 도착 + 1초 마진 후 자동 인쇄 (한 번만)
  useEffect(() => {
    if (!data || printedRef.current) return;
    printedRef.current = true;
    const t = setTimeout(() => window.print(), 1000);
    return () => clearTimeout(t);
  }, [data]);

  if (error) {
    return (
      <div className="error-screen">
        <div>{error}</div>
        <style jsx>{`
          .error-screen {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            font-size: 14pt;
            color: #c00;
            padding: 20mm;
            text-align: center;
          }
        `}</style>
      </div>
    );
  }

  if (!data) {
    return <div style={{ padding: "20mm", color: "#666" }}>불러오는 중…</div>;
  }

  return (
    <>
      <FinancePrintLayout data={data} />

      {/* A3 가로 인쇄 CSS */}
      <style jsx global>{`
        @page {
          size: A3 landscape;
          margin: 8mm;
        }
        @media print {
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
        html,
        body {
          margin: 0;
          padding: 0;
          background: white;
        }
        body {
          font-family: "Malgun Gothic", "맑은 고딕", system-ui, sans-serif;
        }
        @media screen {
          html,
          body {
            background: #ddd;
          }
          body {
            display: flex;
            justify-content: center;
            padding: 8mm;
          }
        }
      `}</style>
      <style jsx global>{`
        @media screen {
          body > div:first-child > :global(.finance-print-layout) {
            width: 404mm;
            height: 281mm;
            background: white;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
            padding: 4mm;
            box-sizing: border-box;
          }
        }
        @media print {
          :global(.finance-print-layout) {
            width: 100%;
            height: 100%;
          }
        }
      `}</style>
    </>
  );
}
