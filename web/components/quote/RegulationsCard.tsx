"use client";

/**
 * 견적 모드 — 관련 조례 카드 (서니로직 모방).
 *
 * 표시 구조:
 *   - 광역 그룹 (충청남도, 서울특별시 등) — 조례/규칙 N건
 *   - 기초 그룹 (부여군, 강남구 등) — 조례/규칙 N건. 단층광역(세종/제주)은 그룹 자체 표시 X
 *   - 종류 배지 (조례=연한 보라, 규칙=진한 보라)
 *   - 법규명 = 법제처 본문 새 창 링크
 *   - 재/개정일 = 시행일자 (YYYY-MM-DD)
 *   - 결과 0건: "조례정보가 존재하지 않습니다" 메시지
 *
 * 데이터: lazy fetch — pnu 변경 시 1회 호출. 캐시 키 = PNU (모듈 scope Map).
 */

import { useEffect, useState } from "react";
import {
  fetchRegulationsByPnu,
  type LawOrdinance,
  type RegulationsByPnuResult,
} from "@/lib/api/regulations";

interface Props {
  pnu: string;
}

export default function RegulationsCard({ pnu }: Props) {
  const [data, setData] = useState<RegulationsByPnuResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pnu) return;
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    fetchRegulationsByPnu(pnu, { signal: ctl.signal })
      .then((r) => {
        if (ctl.signal.aborted) return;
        setData(r);
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
  }, [pnu]);

  return (
    <div className="px-4 py-3">
      <div className="text-[10px] md:text-[11px] font-bold text-gray-500 mb-2 tracking-wider uppercase">
        📋 관련 조례
      </div>

      {loading && (
        <div className="text-xs text-gray-500 py-1">불러오는 중...</div>
      )}

      {error && (
        <div className="text-xs text-red-600 py-1">조회 실패: {error}</div>
      )}

      {!loading && !error && data && (
        <RegulationsContent data={data} />
      )}

      {/* 디스클레이머 — 결과 유무와 관계없이 항상 표시 */}
      {!loading && !error && data && (data.wide.length > 0 || data.local.length > 0) && (
        <div className="text-[10px] text-gray-400 mt-2 leading-snug">
          ⚠ 참고용 정보입니다. 최종 판단은 해당 지자체 확인이 필요합니다.
        </div>
      )}
    </div>
  );
}

function RegulationsContent({ data }: { data: RegulationsByPnuResult }) {
  const total = data.wide.length + data.local.length;
  if (total === 0) {
    return (
      <div className="text-xs text-gray-500 py-1">
        조례 정보가 존재하지 않습니다.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {data.wide.length > 0 && data.region && (
        <RegulationsGroup
          title={`🏛 ${data.region.ctp_nm}`}
          rows={data.wide}
        />
      )}
      {data.local.length > 0 && data.region?.sig_nm && (
        <RegulationsGroup
          title={`🏘 ${data.region.sig_nm}`}
          rows={data.local}
        />
      )}
    </div>
  );
}

function RegulationsGroup({
  title,
  rows,
}: {
  title: string;
  rows: LawOrdinance[];
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-gray-700 mb-1">
        {title}{" "}
        <span className="text-gray-400 font-normal">({rows.length})</span>
      </div>
      <div className="space-y-1">
        {rows.map((row) => (
          <RegulationRow key={row.id || row.mst} row={row} />
        ))}
      </div>
    </div>
  );
}

function RegulationRow({ row }: { row: LawOrdinance }) {
  const isRule = row.kind === "규칙";
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span
        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${
          isRule
            ? "bg-purple-600 text-white"
            : "bg-purple-100 text-purple-800"
        }`}
      >
        {row.kind || "조례"}
      </span>
      <a
        href={row.detailUrl}
        target="_blank"
        rel="noreferrer"
        className="flex-1 text-blue-700 hover:text-blue-900 hover:underline truncate"
        title={row.name}
      >
        {row.name}
      </a>
      <span className="text-[10px] text-gray-500 tabular-nums shrink-0">
        {formatYmd(row.effectiveDate)}
      </span>
    </div>
  );
}

/** "20241230" → "2024-12-30" */
function formatYmd(ymd: string): string {
  if (!ymd || ymd.length < 8) return ymd || "—";
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}
