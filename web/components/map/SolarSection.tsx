"use client";

/**
 * 입지 탭 — 태양광 발전소 섹션.
 *
 * 두 박스:
 *   1) 이 필지에 등록된 발전소 (정확 매칭, same_pnu)
 *   2) 이 동(리) 일대 통계 (광역, same_dong)
 *
 * lazy fetch — 입지 탭 진입 시 1회 호출. 캐시 키 = PNU.
 * 데이터 출처: solar_permits 테이블 (매월 1일 09:00 KST 갱신).
 */
import { useEffect, useState } from "react";
import {
  fetchSolarByPnu,
  type SolarByPnuResult,
  type SolarPermitRow,
} from "@/lib/api/solar-permits";

interface Props {
  pnu: string;
  /** 동/리 표기 — 예: "장암면 지토리". 빈 값이면 "이" 로 폴백 ("이 일대"). */
  areaLabel: string;
}

export default function SolarSection({ pnu, areaLabel }: Props) {
  const [data, setData] = useState<SolarByPnuResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pnu) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    fetchSolarByPnu(pnu, { signal: controller.signal })
      .then((r) => {
        if (controller.signal.aborted) return;
        setData(r);
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [pnu]);

  return (
    <div>
      <div className="text-[10px] md:text-[11px] font-bold text-gray-500 mb-2 tracking-wider uppercase">
        ☀ 태양광 발전소
      </div>

      {loading && (
        <div className="text-xs text-gray-500 py-1">불러오는 중...</div>
      )}

      {error && (
        <div className="text-xs text-red-600 py-1">조회 실패: {error}</div>
      )}

      {!loading && !error && data && (
        <div className="space-y-3">
          {data.samePnu.length === 0 && data.sameDong.count === 0 ? (
            // 둘 다 빈 — 한 줄로 통합
            <div className="text-xs text-gray-500">
              이 일대 등록된 발전소 없음
            </div>
          ) : (
            <>
              {/* ① 같은 필지 */}
              {data.samePnu.length > 0 ? (
                <div>
                  <div className="text-[11px] font-semibold text-gray-700 mb-1.5">
                    ◇ 이 필지에 등록된 발전소 ({data.samePnu.length}개)
                  </div>
                  <div className="space-y-1.5">
                    {data.samePnu.map((row, i) => (
                      <SolarCard key={i} row={row} />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-gray-500">
                  이 필지에 등록된 발전소 없음
                </div>
              )}

              {/* ② 같은 동/리 (count > 0 일 때만 — 0 이면 위에서 통합 처리됨) */}
              {data.sameDong.count > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-gray-700 mb-1">
                    ◇ {areaLabel || "이"} 일대
                  </div>
                  <div className="text-sm text-gray-900">
                    발전소 <b>{data.sameDong.count.toLocaleString()}</b>개 · 총{" "}
                    <b className="text-emerald-700">
                      {data.sameDong.totalKw.toLocaleString()}
                    </b>{" "}
                    kW
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** 발전소 한 건 — 이름 / 용량 / 운영상태 / 허가년월 */
function SolarCard({ row }: { row: SolarPermitRow }) {
  return (
    <div className="bg-emerald-50/50 border border-emerald-200 rounded px-2.5 py-1.5">
      <div className="text-sm font-semibold text-gray-900 truncate">
        {row.facility_name}
      </div>
      <div className="text-[11px] text-gray-600 mt-0.5 flex flex-wrap items-center gap-x-1">
        {row.capacity_kw != null && (
          <span className="font-semibold text-emerald-700">
            {row.capacity_kw.toLocaleString()} kW
          </span>
        )}
        {row.operating_status && (
          <>
            <span className="text-gray-300">·</span>
            <span>{row.operating_status}</span>
          </>
        )}
        {row.permit_date && (
          <>
            <span className="text-gray-300">·</span>
            <span>{formatPermitDate(row.permit_date)}</span>
          </>
        )}
      </div>
    </div>
  );
}

/** "2023-01-15" → "2023.01" (년·월만, 카드 좁아서) */
function formatPermitDate(dateStr: string): string {
  const m = dateStr.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}.${m[2]}` : dateStr;
}
