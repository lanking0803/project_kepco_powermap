"use client";

/**
 * 공매 매물 상세 탭 — ParcelInfoPanel 안에서 표시.
 *
 * 호출 방식:
 *   - 사용자가 [공매] 탭 클릭 → useEffect 가 fetchOnbidByPnu(pnu) 호출.
 *   - 모듈 캐시 있으면 즉시 표시 (탭 재방문 비용 0).
 *   - 한 PNU 에 매물 N건 가능 — 카드 N개 렌더.
 *
 * Phase 1 (백엔드 연결) 후에는 fetchOnbidByPnu 가 실 API 로 교체되며
 * OnbidDetail (사진/papsInf 등) 도 동일 함수에서 받게 확장.
 */

import { useEffect, useState } from "react";
import type { OnbidListItem } from "@/lib/onbid/types";
import { OUR_CATEGORY_LABEL } from "@/lib/onbid/types";
import { fetchOnbidByPnu } from "@/lib/onbid/by-pnu";

export default function OnbidTab({ pnu }: { pnu: string }) {
  const [items, setItems] = useState<OnbidListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchOnbidByPnu(pnu)
      .then((rows) => {
        if (alive) setItems(rows);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [pnu]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <div className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
        <div className="text-xs text-gray-500">공매 매물 조회 중...</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-center py-8 text-xs text-red-600">
        조회 실패: {error}
      </div>
    );
  }
  if (!items || items.length === 0) {
    return (
      <div className="text-center py-10 text-xs text-gray-500 bg-gray-50 rounded border border-dashed border-gray-200">
        이 필지에 공매 매물이 없습니다
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <OnbidItemBody key={item.cltrMngNo} item={item} />
      ))}
    </div>
  );
}

// ───────────────────────────────────────────
// 매물 1건 본문 (이전 구버전 OnbidTab 의 본문을 그대로 가져옴)
// ───────────────────────────────────────────

function OnbidItemBody({ item }: { item: OnbidListItem }) {
  const dayLabel = item.daysLeft < 0 ? "마감" : `D-${item.daysLeft}`;
  const dayBadgeClass = item.daysLeft < 0
    ? "bg-gray-100 text-gray-500 line-through"
    : item.isUrgent
      ? "bg-rose-600 text-white"
      : "bg-rose-50 text-rose-700 border border-rose-200";

  const discountPct = Math.round(item.discountRatio * 100);
  const bidStart = formatBidDate(item.cltrBidBgngDt);
  const bidEnd = formatBidDate(item.cltrBidEndDt);

  return (
    <div className="border border-rose-200 rounded-lg p-3 space-y-3 bg-rose-50/30">
      {/* 헤더 */}
      <div className="pb-2 border-b border-rose-100">
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${dayBadgeClass}`}>
            {dayLabel}
          </span>
          {item.ourCategory && (
            <span className="text-xs font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded">
              {OUR_CATEGORY_LABEL[item.ourCategory]}
            </span>
          )}
          <span className="text-xs text-gray-500">
            {item.cltrUsgSclsCtgrNm}
          </span>
        </div>
        <div className="text-sm font-semibold text-gray-900 leading-tight">
          {item.onbidCltrNm}
        </div>
      </div>

      {/* 가격 */}
      <div className="grid grid-cols-2 gap-2">
        <PriceCell label="감정가" amount={item.apslEvlAmt} muted />
        <PriceCell
          label="최저입찰가"
          amount={item.lowstBidPrc}
          highlight
          footnote={discountPct > 0 ? `${discountPct}% 할인` : undefined}
        />
      </div>

      {/* 입찰일정 */}
      <div className="text-xs text-gray-700 space-y-1">
        <Row label="입찰 시작" value={bidStart} />
        <Row label="입찰 종료" value={bidEnd} highlight={item.isUrgent} />
      </div>

      {/* 면적/부가 */}
      <div className="text-xs text-gray-700 space-y-1">
        {item.landSqms != null && (
          <Row
            label="토지면적"
            value={`${item.landSqms.toLocaleString()} ㎡ (${toPyeong(item.landSqms)}평)`}
          />
        )}
        {item.bldSqms != null && item.bldSqms > 0 && (
          <Row
            label="건물면적"
            value={`${item.bldSqms.toLocaleString()} ㎡ (${toPyeong(item.bldSqms)}평)`}
          />
        )}
        <Row label="재산유형" value={item.prptDivNm} />
        <Row
          label="유찰"
          value={item.usbdNft != null ? `${item.usbdNft}회` : "—"}
        />
        <Row label="물건관리번호" value={item.cltrMngNo} mono />
      </div>

      {/* 외부 링크 — Phase 1 검증 후 활성 */}
      <button
        type="button"
        disabled
        className="block w-full py-2 text-xs font-bold text-center
                   bg-gray-100 text-gray-400 rounded-md cursor-not-allowed"
        title={`온비드물건번호: ${item.onbidCltrno} (Phase 1 검증 후 외부 링크 활성)`}
      >
        🔗 캠코 사이트로 (준비 중)
      </button>
    </div>
  );
}

// ─── 보조 컴포넌트 ────────────────────────

function Row({
  label,
  value,
  highlight,
  mono,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-gray-500 w-20 shrink-0">{label}</span>
      <span
        className={`flex-1 ${highlight ? "text-rose-700 font-semibold" : "text-gray-900"} ${
          mono ? "font-mono text-[11px]" : ""
        } tabular-nums`}
      >
        {value}
      </span>
    </div>
  );
}

function PriceCell({
  label,
  amount,
  muted,
  highlight,
  footnote,
}: {
  label: string;
  amount: number;
  muted?: boolean;
  highlight?: boolean;
  footnote?: string;
}) {
  const colorClass = highlight ? "text-rose-700" : muted ? "text-gray-500" : "text-gray-900";
  return (
    <div
      className={`rounded-md border p-2.5 ${
        highlight ? "border-rose-200 bg-rose-50/40" : "border-gray-200 bg-gray-50"
      }`}
    >
      <div className="text-[10px] font-semibold text-gray-500 mb-0.5">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${colorClass}`}>
        {formatPrice(amount)}
      </div>
      {footnote && (
        <div className="text-[10px] text-rose-700 font-semibold mt-0.5">
          {footnote}
        </div>
      )}
    </div>
  );
}

// ─── 포맷 헬퍼 ────────────────────────────

function formatPrice(won: number): string {
  if (won >= 100_000_000) {
    const eok = won / 100_000_000;
    return eok >= 10 ? `${Math.round(eok).toLocaleString()}억원` : `${eok.toFixed(2)}억원`;
  }
  if (won >= 10_000) return `${Math.round(won / 10_000).toLocaleString()}만원`;
  return `${won.toLocaleString()}원`;
}

function formatBidDate(yyyymmddhhmm: string): string {
  if (!yyyymmddhhmm || yyyymmddhhmm.length < 12) return yyyymmddhhmm || "—";
  const y = yyyymmddhhmm.slice(0, 4);
  const mo = yyyymmddhhmm.slice(4, 6);
  const d = yyyymmddhhmm.slice(6, 8);
  const h = yyyymmddhhmm.slice(8, 10);
  const mi = yyyymmddhhmm.slice(10, 12);
  return `${y}-${mo}-${d} ${h}:${mi}`;
}

const M2_TO_PYEONG = 0.3025;
function toPyeong(m2: number): string {
  return Math.round(m2 * M2_TO_PYEONG).toLocaleString();
}
