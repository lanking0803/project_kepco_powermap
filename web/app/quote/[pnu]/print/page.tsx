"use client";

/**
 * 도면 출력 (3단계) 인쇄 라우트 — A3 가로 봉남리 양식 1페이지.
 *
 * 흐름:
 *   1. 견적 모드에서 [📄 도면 PDF 저장] 버튼 → sessionStorage 에 데이터 저장 → 새 탭 오픈
 *   2. 이 페이지 로드 → loadBlueprintData(pnu) 로 데이터 읽음
 *   3. PrintLayout 렌더 (P3) — 좌측 위성/패널, 우측 정보 박스
 *   4. P5 에서 카카오맵 tilesloaded + 1.5초 대기 → window.print() 자동 호출
 *
 * Step P1~P3: 라우트 + 양식 골격 (지도는 placeholder).
 * Step P4 에서 PrintMap 컴포넌트로 mapSlot 채움.
 */

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import PrintLayout from "@/components/quote/PrintLayout";
import QuoteMap, { type EditableBuilding } from "@/components/quote/QuoteMap";
import {
  loadBlueprintData,
  type BlueprintPrintData,
} from "@/lib/quote/print-data";

interface Props {
  params: Promise<{ pnu: string }>;
}

export default function PrintPage({ params }: Props) {
  const { pnu } = use(params);
  const [data, setData] = useState<BlueprintPrintData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const printedRef = useRef(false);

  useEffect(() => {
    const loaded = loadBlueprintData(pnu);
    if (!loaded) {
      setError(
        "인쇄 데이터를 찾을 수 없습니다. 견적 모드에서 [📄 도면 PDF 저장] 버튼으로 다시 진입해주세요.",
      );
      return;
    }
    setData(loaded);
  }, [pnu]);

  /** 카카오맵 + 패널 모두 그려졌을 때 자동 인쇄 다이얼로그 띄움 (한 번만) */
  const handleMapReady = useCallback(() => {
    if (printedRef.current) return;
    printedRef.current = true;
    window.print();
  }, []);

  /** PrintBuilding → EditableBuilding (QuoteMap 호환). 패널/면적/이름 동일 구조 */
  const editableBuildings: EditableBuilding[] = useMemo(() => {
    if (!data) return [];
    return data.buildings.map((b) => ({
      id: b.id,
      name: b.name,
      polygon: b.polygon,
      area_m2: b.area_m2,
      panels: b.panels,
      widthM: b.widthM,
      heightM: b.heightM,
    }));
  }, [data]);

  if (error) {
    return (
      <div className="error-screen">
        <div>{error}</div>
      </div>
    );
  }

  if (!data) {
    return <div className="loading-screen">데이터 불러오는 중…</div>;
  }

  return (
    <>
      <PrintLayout
        data={data}
        mapSlot={
          <QuoteMap
            parcelPolygon={null}
            buildings={editableBuildings}
            printMode
            onReady={handleMapReady}
          />
        }
      />

      {/* A3 가로 인쇄 CSS — globals.css 와 충돌 없도록 :global 처리 */}
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
        /* A3 가로 프리뷰 (화면) — 인쇄 시 @page 가 적용됨 */
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

      <style jsx>{`
        .error-screen,
        .loading-screen {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          font-size: 14pt;
          color: #666;
          padding: 20mm;
          text-align: center;
        }
        .error-screen {
          color: #c00;
        }
      `}</style>

      {/* A3 가로 = 420mm × 297mm (margin 8mm 빼면 404 × 281mm) */}
      <style jsx global>{`
        @media screen {
          body > div:first-child > :global(.print-layout) {
            width: 404mm;
            height: 281mm;
            background: white;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
            padding: 4mm;
            box-sizing: border-box;
          }
        }
        @media print {
          :global(.print-layout) {
            width: 100%;
            height: 100%;
          }
        }
      `}</style>
    </>
  );
}
