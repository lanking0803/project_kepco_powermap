"use client";

/**
 * 공매 매물 상세 탭 — ParcelInfoPanel 안에서 표시.
 *
 * 호출 방식:
 *   - 사용자가 [공매] 탭 클릭 → useEffect 가 fetchOnbidByPnu(pnu) 호출.
 *   - /api/onbid/by-pnu 내부에서 캠코 목록 + 상세 병렬 호출.
 *   - 모듈 캐시 있으면 즉시 표시 (탭 재방문 비용 0).
 *
 * 표시 정보 (캠코 응답 풍부):
 *   - 사진 갤러리 (가로 스크롤)
 *   - 360도/영상 (있으면)
 *   - 가격: 감정가 → 최저입찰가 + 할인율
 *   - 입찰 일정: 시작/종료 + 최초 공고일
 *   - 위치 묘사 (locVntyPscdCont)
 *   - 활용/이용 (utlzPscdCont)
 *   - 입찰조건 / 매수자격 / 납부사항
 *   - 감정평가 이력 (PDF 링크)
 *   - 면적 / 재산유형 / 유찰
 */

import { useEffect, useState } from "react";
import type { AppraisalRecord, OnbidDetail } from "@/lib/onbid/types";
import { OUR_CATEGORY_LABEL } from "@/lib/onbid/types";
import { fetchOnbidByPnu } from "@/lib/onbid/by-pnu";

export default function OnbidTab({ pnu }: { pnu: string }) {
  const [items, setItems] = useState<OnbidDetail[] | null>(null);
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
        이 필지에 진행 중인 공매 매물이 없습니다
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <DetailCard key={item.cltrMngNo} item={item} />
      ))}
    </div>
  );
}

// ───────────────────────────────────────────
// 매물 1건 상세 카드
// ───────────────────────────────────────────

function DetailCard({ item }: { item: OnbidDetail }) {
  const dayLabel = item.daysLeft < 0 ? "마감" : `D-${item.daysLeft}`;
  const dayBadgeClass = item.daysLeft < 0
    ? "bg-gray-100 text-gray-500 line-through"
    : item.isUrgent
      ? "bg-rose-600 text-white animate-pulse"
      : "bg-rose-50 text-rose-700 border border-rose-200";

  const discountPct = Math.round(item.discountRatio * 100);

  return (
    <div className="border border-rose-200 rounded-lg overflow-hidden bg-rose-50/30">
      {/* 헤더 */}
      <div className="px-3 py-2.5 bg-rose-50 border-b border-rose-100">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${dayBadgeClass}`}>
            {dayLabel}
          </span>
          {item.ourCategory && (
            <span className="text-xs font-semibold text-rose-700 bg-white px-2 py-0.5 rounded border border-rose-200">
              {OUR_CATEGORY_LABEL[item.ourCategory]}
            </span>
          )}
          <span className="text-xs text-gray-600">{item.cltrUsgSclsCtgrNm}</span>
          {item.usbdNft != null && item.usbdNft > 0 && (
            <span className="ml-auto text-[11px] text-gray-500">
              유찰 {item.usbdNft}회
            </span>
          )}
        </div>
        <div className="text-sm font-semibold text-gray-900 leading-tight">
          {item.onbidCltrNm}
        </div>
        {item.cltrRadr && (
          <div className="text-[11px] text-gray-500 mt-1">
            🏠 {item.cltrRadr}
          </div>
        )}
      </div>

      <div className="p-3 space-y-3">
        {/* 사진 갤러리 */}
        {item.photoUrls.length > 0 && (
          <PhotoGallery photos={item.photoUrls} />
        )}

        {/* 360 / 영상 */}
        {(item.photo360Urls.length > 0 || item.videoUrls.length > 0) && (
          <Section title="🎥 멀티미디어">
            <div className="flex flex-wrap gap-2 text-[11px]">
              {item.photo360Urls.map((u, i) => (
                <a
                  key={`360-${i}`}
                  href={u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-700"
                >
                  🔄 360도 {i + 1}
                </a>
              ))}
              {item.videoUrls.map((u, i) => (
                <a
                  key={`v-${i}`}
                  href={u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-700"
                >
                  📹 영상 {i + 1}
                </a>
              ))}
            </div>
          </Section>
        )}

        {/* 가격 */}
        <Section title="💰 가격">
          <div className="grid grid-cols-2 gap-2">
            <PriceCell label="감정가" amount={item.apslEvlAmt} muted />
            <PriceCell
              label="최저입찰가"
              amount={item.lowstBidPrc}
              highlight
              footnote={discountPct > 0 ? `${discountPct}% 할인` : undefined}
            />
          </div>
        </Section>

        {/* 입찰 일정 */}
        <Section title="📅 입찰 일정">
          <div className="text-xs text-gray-700 space-y-1">
            <Row label="시작" value={formatBidDate(item.cltrBidBgngDt)} />
            <Row
              label="종료"
              value={formatBidDate(item.cltrBidEndDt)}
              highlight={item.isUrgent}
            />
            {item.frstPbancYmd && (
              <Row label="최초공고" value={formatYmd(item.frstPbancYmd)} muted />
            )}
          </div>
        </Section>

        {/* 면적 */}
        <Section title="📐 면적">
          <div className="text-xs text-gray-700 space-y-1">
            {item.landSqms != null && (
              <Row
                label="토지"
                value={`${item.landSqms.toLocaleString()} ㎡ (${toPyeong(item.landSqms)}평)`}
              />
            )}
            {item.bldSqms != null && item.bldSqms > 0 && (
              <Row
                label="건물"
                value={`${item.bldSqms.toLocaleString()} ㎡ (${toPyeong(item.bldSqms)}평)`}
              />
            )}
          </div>
        </Section>

        {/* 위치/접근성 */}
        {item.locVntyPscdCont && (
          <Section title="📍 위치 / 접근성">
            <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-line">
              {item.locVntyPscdCont}
            </div>
          </Section>
        )}

        {/* 활용/이용 */}
        {item.utlzPscdCont && (
          <Section title="🌳 활용 / 이용 현황">
            <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-line">
              {item.utlzPscdCont}
            </div>
          </Section>
        )}

        {/* 입찰조건 */}
        {item.icdlCdtnCont && (
          <Section title="📋 입찰조건">
            <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-line">
              {item.icdlCdtnCont}
            </div>
          </Section>
        )}

        {/* 매수자격 */}
        {item.purrQlfcCont && (
          <Section title="👤 매수자격">
            <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-line">
              {item.purrQlfcCont}
            </div>
          </Section>
        )}

        {/* 납부사항 */}
        {item.pytnMtrsCont && (
          <Section title="💳 납부사항 / 유의사항">
            <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-line">
              {item.pytnMtrsCont}
            </div>
          </Section>
        )}

        {/* 인도/인수 책임 */}
        {item.evcRsbyTrgtCont && (
          <Section title="🤝 인도/인수 책임">
            <div className="text-xs text-gray-700">{item.evcRsbyTrgtCont}</div>
          </Section>
        )}

        {/* 기타사항 */}
        {item.cltrEtcCont && (
          <Section title="ℹ️ 기타사항">
            <div className="text-xs text-gray-700 whitespace-pre-line">
              {item.cltrEtcCont}
            </div>
          </Section>
        )}

        {/* 감정평가 이력 */}
        {item.appraisals.length > 0 && (
          <Section title="📊 감정평가 이력">
            <div className="space-y-1.5">
              {item.appraisals.map((a, i) => (
                <AppraisalRow key={i} appraisal={a} />
              ))}
            </div>
          </Section>
        )}

        {/* 부가정보 */}
        <Section title="📎 부가 정보">
          <div className="text-xs text-gray-700 space-y-1">
            <Row label="재산유형" value={item.prptDivNm} />
            <Row label="물건관리번호" value={item.cltrMngNo} mono />
          </div>
        </Section>

        {/* 외부 링크 — Phase 2 검증 후 활성 */}
        <button
          type="button"
          disabled
          className="block w-full py-2 text-xs font-bold text-center
                     bg-gray-100 text-gray-400 rounded-md cursor-not-allowed"
          title={`온비드물건번호: ${item.onbidCltrno}`}
        >
          🔗 캠코 사이트로 (준비 중)
        </button>
      </div>
    </div>
  );
}

// ─── 보조 컴포넌트 ────────────────────────

function PhotoGallery({ photos }: { photos: string[] }) {
  const [activeIdx, setActiveIdx] = useState(0);
  return (
    <div>
      <div className="text-[10px] md:text-[11px] font-bold text-gray-500 mb-1.5 tracking-wider uppercase">
        📷 사진 ({photos.length})
      </div>
      {/* 큰 사진 */}
      <div className="aspect-video bg-gray-100 rounded-md overflow-hidden mb-1.5 relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photos[activeIdx]}
          alt={`매물 사진 ${activeIdx + 1}`}
          className="w-full h-full object-contain"
          loading="lazy"
        />
        {photos.length > 1 && (
          <>
            <button
              type="button"
              onClick={() =>
                setActiveIdx((i) => (i - 1 + photos.length) % photos.length)
              }
              className="absolute left-1 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/40 hover:bg-black/60 text-white rounded-full text-sm"
              aria-label="이전 사진"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={() => setActiveIdx((i) => (i + 1) % photos.length)}
              className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/40 hover:bg-black/60 text-white rounded-full text-sm"
              aria-label="다음 사진"
            >
              ▶
            </button>
            <span className="absolute right-2 bottom-2 px-2 py-0.5 bg-black/60 text-white text-[10px] rounded">
              {activeIdx + 1} / {photos.length}
            </span>
          </>
        )}
      </div>
      {/* 썸네일 가로 스크롤 */}
      {photos.length > 1 && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {photos.map((u, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveIdx(i)}
              className={`flex-shrink-0 w-12 h-12 rounded overflow-hidden border-2 transition-colors ${
                i === activeIdx ? "border-rose-500" : "border-transparent"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={u}
                alt={`썸네일 ${i + 1}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] md:text-[11px] font-bold text-gray-500 mb-1.5 tracking-wider uppercase">
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  highlight,
  mono,
  muted,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-gray-500 w-20 shrink-0">{label}</span>
      <span
        className={`flex-1 ${
          highlight
            ? "text-rose-700 font-semibold"
            : muted
              ? "text-gray-500"
              : "text-gray-900"
        } ${mono ? "font-mono text-[11px]" : ""} tabular-nums`}
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
  const colorClass = highlight
    ? "text-rose-700"
    : muted
      ? "text-gray-500"
      : "text-gray-900";
  return (
    <div
      className={`rounded-md border p-2.5 ${
        highlight ? "border-rose-300 bg-white" : "border-gray-200 bg-gray-50"
      }`}
    >
      <div className="text-[10px] font-semibold text-gray-500 mb-0.5">
        {label}
      </div>
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

function AppraisalRow({ appraisal }: { appraisal: AppraisalRecord }) {
  return (
    <div className="text-xs flex items-baseline gap-2 bg-white border border-gray-200 rounded px-2 py-1.5">
      <span className="text-gray-500 tabular-nums shrink-0">
        {formatYmd(appraisal.date)}
      </span>
      <span className="text-gray-900 truncate flex-1">{appraisal.org}</span>
      <span className="font-semibold text-gray-900 tabular-nums shrink-0">
        {formatPrice(appraisal.amount)}
      </span>
      {appraisal.pdfUrl && (
        <a
          href={appraisal.pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-rose-600 hover:text-rose-800 text-[10px] font-bold shrink-0"
          title="감정평가서 PDF"
        >
          📄 PDF
        </a>
      )}
    </div>
  );
}

// ─── 포맷 헬퍼 ────────────────────────────

function formatPrice(won: number): string {
  if (won >= 100_000_000) {
    const eok = won / 100_000_000;
    return eok >= 10
      ? `${Math.round(eok).toLocaleString()}억원`
      : `${eok.toFixed(2)}억원`;
  }
  if (won >= 10_000) return `${Math.round(won / 10_000).toLocaleString()}만원`;
  return `${won.toLocaleString()}원`;
}

function formatBidDate(yyyymmddhhmm: string | null | undefined): string {
  if (!yyyymmddhhmm || yyyymmddhhmm.length < 12) return yyyymmddhhmm || "—";
  const y = yyyymmddhhmm.slice(0, 4);
  const mo = yyyymmddhhmm.slice(4, 6);
  const d = yyyymmddhhmm.slice(6, 8);
  const h = yyyymmddhhmm.slice(8, 10);
  const mi = yyyymmddhhmm.slice(10, 12);
  return `${y}-${mo}-${d} ${h}:${mi}`;
}

function formatYmd(yyyymmdd: string | null | undefined): string {
  if (!yyyymmdd || yyyymmdd.length < 8) return yyyymmdd || "—";
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

const M2_TO_PYEONG = 0.3025;
function toPyeong(m2: number): string {
  return Math.round(m2 * M2_TO_PYEONG).toLocaleString();
}
