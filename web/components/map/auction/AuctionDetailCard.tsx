"use client";

/**
 * 경매 매물 1건 상세 카드 — AuctionTab 안에 인라인 표시.
 *
 * 영업담당자 관점 (의뢰자 의도):
 *   1. 헤더 — 사건명칭/진행상태/용도/주소
 *   2. ⭐ 영업 OverviewCard — 감정가/최저가/할인율/매각기일/매각조건
 *   3. 🏛 법원 정보 — 법원명/담당계/담당계전화 (입찰 등록 시 즉시 활용)
 *   4. 📐 면적 / 유찰 / 사건당사자 (lazy)
 *   5. 📷 사진 갤러리 (lazy 상세 호출 후)
 *   6. 📋 권리분석 (lazy 상세 호출 후)
 *   7. 💰 시뮬레이션 — 예상명도비/예상배당 (lazy)
 *   8. 📍 인근정보 — 인근물건/매각사례 (lazy)
 *
 * 상세 호출은 "상세 펼치기" 버튼 클릭 시에만 (호출 비용 절약 + 빠른 첫 렌더).
 *
 * 스타일: 캠코 OnbidTab 의 DetailCard 미러 — rose → amber 톤 변경.
 */

import { useState } from "react";

import { fetchAuctionDetailLazy } from "@/lib/hyphen/detail";
import type {
  AuctionListItem,
  AuctionRawDetailItem,
  HyphenApiStatus,
} from "@/lib/hyphen/types";

import ApiStatusBanner from "./ApiStatusBanner";

export default function AuctionDetailCard({
  item,
}: {
  item: AuctionListItem;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<AuctionRawDetailItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailStatus, setDetailStatus] = useState<HyphenApiStatus>("ok");
  const [detailErrCd, setDetailErrCd] = useState("");
  const [detailErrMsg, setDetailErrMsg] = useState("");

  async function handleExpand() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (detail) return; // 이미 로드됨
    setDetailLoading(true);
    try {
      const res = await fetchAuctionDetailLazy(item.경매번호);
      setDetailStatus(res.apiStatus);
      setDetailErrCd(res.errCd);
      setDetailErrMsg(res.errMsg);
      setDetail(res.detail);
    } catch (e) {
      console.error("[AuctionDetailCard] 상세 호출 실패", e);
    } finally {
      setDetailLoading(false);
    }
  }

  const discountPct = Math.round(item.discountRatio * 100);

  return (
    <div className="border border-amber-200 rounded-lg overflow-hidden bg-white">
      {/* ── 1. 헤더 ── */}
      <div className="px-3 py-2.5 bg-amber-50 border-b border-amber-100">
        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
          <StatusBadge status={item.진행상태} />
          {item.용도 && (
            <span className="text-[10px] text-gray-700 bg-white px-1.5 py-0.5 rounded border border-amber-200">
              {item.용도}
            </span>
          )}
          {item.daysLeft >= -9000 && (
            <span
              className={`text-[10px] font-semibold ${
                item.isUrgent ? "text-red-600" : "text-gray-600"
              }`}
            >
              {formatDday(item.daysLeft)}
            </span>
          )}
          <span className="text-[10px] text-gray-400">·</span>
          <span className="text-[10px] text-gray-500">{item.사건명칭}</span>
        </div>
        <div className="text-sm font-bold text-gray-900 leading-tight">
          {item.대표소재지 || item.리스트지번주소}
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* ── 2. 영업 OverviewCard ── */}
        <OverviewCard item={item} discountPct={discountPct} />

        {/* ── 3. 법원 정보 ── */}
        <Section title="🏛 법원 / 담당계">
          <div className="text-xs text-gray-700 space-y-1">
            <Row label="법원" value={item.법원간략명 || "—"} />
            <Row label="담당계" value={item.담당계 || "—"} />
            {/* 담당계전화는 detail 응답에서 옴 (lazy) */}
            {detail?.담당계전화 && (
              <Row
                label="전화"
                value={
                  <a
                    href={`tel:${stripPhone(detail.담당계전화)}`}
                    className="text-amber-700 hover:underline"
                  >
                    {detail.담당계전화}
                  </a>
                }
              />
            )}
            <Row label="사건명칭" value={item.사건명칭} mono />
            <Row label="경매번호" value={String(item.경매번호)} mono />
          </div>
        </Section>

        {/* ── 4. 면적 / 유찰 ── */}
        {(hasArea(item.토지면적) ||
          hasArea(item.건물면적) ||
          item.유찰수 > 0) && (
          <Section title="📐 면적 / 유찰">
            <div className="text-xs text-gray-700 space-y-1">
              {hasArea(item.토지면적) && (
                <Row
                  label="토지"
                  value={`${item.토지면적!.toLocaleString()} ㎡ (${toPyeong(item.토지면적!)}평)`}
                />
              )}
              {hasArea(item.건물면적) && (
                <Row
                  label="건물"
                  value={`${item.건물면적!.toLocaleString()} ㎡ (${toPyeong(item.건물면적!)}평)`}
                />
              )}
              {item.유찰수 > 0 && (
                <Row label="유찰" value={`${item.유찰수}회`} highlight />
              )}
              {item.낙찰가 != null && item.낙찰가 > 0 && (
                <Row label="낙찰가" value={formatWon(item.낙찰가)} muted />
              )}
            </div>
          </Section>
        )}

        {/* ── 5. 상세 펼치기 버튼 ── */}
        <button
          type="button"
          onClick={handleExpand}
          disabled={detailLoading}
          className="w-full text-xs font-semibold py-2 rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 transition-colors disabled:opacity-60"
        >
          {detailLoading ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 border border-amber-700 border-t-transparent rounded-full animate-spin inline-block" />
              상세 정보 불러오는 중...
            </span>
          ) : expanded ? (
            "상세 정보 접기 ▲"
          ) : (
            "상세 정보 펼치기 (사진 / 권리분석 / 명도비) ▼"
          )}
        </button>

        {/* ── 6. 상세 영역 (expanded + detail 로드된 경우) ── */}
        {expanded &&
          detailStatus !== "ok" &&
          detailStatus !== "empty" && (
            <ApiStatusBanner
              apiStatus={detailStatus}
              errCd={detailErrCd}
              errMsg={detailErrMsg}
            />
          )}

        {expanded && detail && (
          <DetailExtra detail={detail} item={item} />
        )}
      </div>
    </div>
  );
}

// ─── 영업 OverviewCard ────────────────────────────────────

function OverviewCard({
  item,
  discountPct,
}: {
  item: AuctionListItem;
  discountPct: number;
}) {
  return (
    <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-lg p-3">
      {/* 가격 라인 */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">
          매각 / 가격
        </div>
        <div className="text-[10px] text-gray-500">
          {item.매각기일일자 || item.매각기일?.slice(0, 10)}
          {item.매각기일일시 ? ` ${item.매각기일일시}` : ""}
        </div>
      </div>

      <div className="flex items-end gap-3 mb-2">
        <div className="flex-1">
          <div className="text-[10px] text-gray-500">감정가</div>
          <div className="text-sm text-gray-700 tabular-nums">
            {formatWon(item.감정가)}
          </div>
        </div>
        <div className="text-gray-400 text-lg pb-1">→</div>
        <div className="flex-1">
          <div className="text-[10px] text-gray-500">최저가</div>
          <div className="text-xl font-bold text-gray-900 tabular-nums leading-tight">
            {formatWon(item.최저가)}
          </div>
        </div>
        {discountPct > 0 && (
          <div className="text-2xl font-bold text-red-600 tabular-nums leading-tight">
            -{discountPct}%
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 상세 응답 표시 (lazy 로드 후) ────────────────────────

function DetailExtra({
  detail,
  item,
}: {
  detail: AuctionRawDetailItem;
  item: AuctionListItem;
}) {
  return (
    <>
      {/* 사진 갤러리 */}
      {detail.이미지리스트 && detail.이미지리스트.length > 0 && (
        <Section title="📷 사진">
          <div className="grid grid-cols-3 gap-1.5">
            {detail.이미지리스트.map((img, i) => {
              const url = `https://www.auctionall.co.kr${img.사진경로}${img.파일명}`;
              return (
                <a
                  key={`${img.이미지일련번호}-${i}`}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block aspect-square overflow-hidden rounded border border-amber-200 bg-gray-50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={img.사진설명 || `매물 사진 ${i + 1}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </a>
              );
            })}
          </div>
        </Section>
      )}

      {/* 매각조건 — 영업 핵심 (예: "맹지") */}
      {detail.매각조건 && (
        <Section title="⚠️ 매각조건">
          <div className="text-xs text-gray-700 bg-amber-50 px-2 py-1.5 rounded border border-amber-100">
            {detail.매각조건}
          </div>
        </Section>
      )}

      {/* 사건당사자 */}
      <Section title="👤 사건당사자">
        <div className="text-xs text-gray-700 space-y-1">
          {detail.소유자 && <Row label="소유자" value={detail.소유자} />}
          {detail.채무자 && <Row label="채무자" value={detail.채무자} />}
          {detail.채권자 && <Row label="채권자" value={detail.채권자} />}
        </div>
      </Section>

      {/* 진행과정 */}
      {detail.진행과정 && (
        <Section title="📅 진행과정">
          <div className="text-xs text-gray-700 space-y-1">
            {detail.진행과정.경매개시일 && (
              <Row label="경매 개시일" value={detail.진행과정.경매개시일} />
            )}
            {detail.진행과정.감정평가일 && (
              <Row label="감정평가일" value={detail.진행과정.감정평가일} />
            )}
            {detail.진행과정.최초경매일 && (
              <Row label="최초 경매일" value={detail.진행과정.최초경매일} />
            )}
            {detail.진행과정.배당종기일 && (
              <Row label="배당 종기일" value={detail.진행과정.배당종기일} />
            )}
          </div>
        </Section>
      )}

      {/* 입찰 가격 (포맷 문자열) */}
      <Section title="💰 입찰 정보 (포맷)">
        <div className="text-xs text-gray-700 space-y-1">
          {detail.감정가 && <Row label="감정가" value={detail.감정가} />}
          {detail.최저가 && <Row label="최저가" value={detail.최저가} />}
          {detail.보증금 && <Row label="보증금" value={detail.보증금} />}
          {detail.대지권면적 && (
            <Row label="대지권면적" value={detail.대지권면적} />
          )}
          {detail.건물면적 && (
            <Row label="건물면적" value={detail.건물면적} />
          )}
        </div>
      </Section>

      {/* 예상명도비용 */}
      {detail.예상명도비용 &&
        Object.keys(detail.예상명도비용).length > 0 && (
          <Section title="🚪 예상 명도비용">
            <div className="text-xs text-gray-700 space-y-1">
              {detail.예상명도비용.종합 && (
                <div className="text-[11px] text-gray-600 bg-gray-50 px-2 py-1.5 rounded">
                  {detail.예상명도비용.종합}
                </div>
              )}
              {detail.예상명도비용.금액 && (
                <Row label="총 금액" value={detail.예상명도비용.금액} highlight />
              )}
              {typeof detail.예상명도비용.노무비 === "number" && (
                <Row
                  label="노무비"
                  value={formatWon(detail.예상명도비용.노무비)}
                  muted
                />
              )}
              {typeof detail.예상명도비용.보관비 === "number" && (
                <Row
                  label="3개월 보관비"
                  value={formatWon(detail.예상명도비용.보관비)}
                  muted
                />
              )}
              {typeof detail.예상명도비용.컨테이너비용 === "number" && (
                <Row
                  label="컨테이너비"
                  value={formatWon(detail.예상명도비용.컨테이너비용)}
                  muted
                />
              )}
            </div>
          </Section>
        )}

      {/* 예상배당순서 */}
      {detail.예상배당순서 && detail.예상배당순서.length > 0 && (
        <Section title="📊 예상 배당순서">
          <div className="text-[11px] text-gray-700 space-y-1">
            {detail.예상배당순서.slice(0, 5).map((d, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-2 py-1 bg-gray-50 rounded"
              >
                <span className="font-bold w-5 tabular-nums">
                  {d.순번 || `${i + 1}`}
                </span>
                <span className="text-gray-700 truncate flex-1">
                  {d.종류 || "—"} · {d.채권자 || "—"}
                </span>
                <span className="text-gray-900 tabular-nums">
                  {d.배당금액 || "—"}
                </span>
              </div>
            ))}
            {detail.예상배당순서.length > 5 && (
              <div className="text-[10px] text-gray-400 text-center">
                ... 외 {detail.예상배당순서.length - 5}건
              </div>
            )}
          </div>
        </Section>
      )}

      {/* 인근물건 */}
      {detail.인근물건 && detail.인근물건.length > 0 && (
        <Section title="📍 인근 매물">
          <div className="text-[11px] text-gray-700 space-y-1">
            {detail.인근물건.slice(0, 5).map((n, i) => (
              <div key={i} className="px-2 py-1.5 bg-gray-50 rounded">
                <div className="font-semibold truncate">
                  {n.인근물건 || "—"}
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  {n.용도 || ""} · {n.매각기일 || ""} · 감정 {n.감정가 || "—"}
                </div>
              </div>
            ))}
            {detail.인근물건.length > 5 && (
              <div className="text-[10px] text-gray-400 text-center">
                ... 외 {detail.인근물건.length - 5}건
              </div>
            )}
          </div>
        </Section>
      )}

      {/* 역세권 */}
      {detail.역세권 && detail.역세권.length > 0 && (
        <Section title="🚇 역세권">
          <div className="text-[11px] text-gray-700 space-y-0.5">
            {detail.역세권.slice(0, 5).map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-gray-500 w-12 truncate">
                  {s.노선명 || "—"}
                </span>
                <span className="font-semibold flex-1 truncate">
                  {s.역명 || "—"}
                </span>
                <span className="text-gray-500 tabular-nums">
                  {typeof s.거리 === "number"
                    ? `${(s.거리 / 1000).toFixed(1)}km`
                    : "—"}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 개발계획 */}
      {detail.개발계획 && detail.개발계획.length > 0 && (
        <Section title="🏗 개발계획 (국토부 LURIS)">
          <div className="text-[11px] text-gray-700 space-y-1">
            {detail.개발계획.slice(0, 3).map((d, i) => (
              <a
                key={i}
                href={d.URL || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-2 py-1 bg-gray-50 rounded hover:bg-amber-50"
              >
                <div className="font-semibold truncate">
                  {d.SUBJECT || d.법정명 || "—"}
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  {d.GUBUN || ""} · {d.OPENDATE || ""}
                </div>
              </a>
            ))}
          </div>
        </Section>
      )}

      {/* 하단주의사항 */}
      {(detail.하단주의사항_01 ||
        detail.하단주의사항_02 ||
        detail.하단주의사항_03) && (
        <Section title="⚠️ 주의사항">
          <div className="text-[11px] text-gray-600 space-y-1.5 leading-relaxed">
            {detail.하단주의사항_01 && <p>{detail.하단주의사항_01}</p>}
            {detail.하단주의사항_02 && <p>{detail.하단주의사항_02}</p>}
            {detail.하단주의사항_03 && <p>{detail.하단주의사항_03}</p>}
          </div>
        </Section>
      )}
    </>
  );
}

// ─── 헬퍼 컴포넌트 ────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] font-bold text-gray-500 mb-1.5 tracking-wider uppercase">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  highlight,
  muted,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
  muted?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[11px] text-gray-500 w-20 shrink-0">{label}</span>
      <span
        className={`text-xs ${
          mono ? "font-mono" : ""
        } ${
          highlight
            ? "font-bold text-amber-700"
            : muted
              ? "text-gray-400"
              : "text-gray-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colorClass = classifyStatusColor(status);
  return (
    <span
      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${colorClass}`}
    >
      {status || "—"}
    </span>
  );
}

// ─── 헬퍼 함수 ────────────────────────────────────────────

function classifyStatusColor(s: string): string {
  if (!s) return "text-gray-600 bg-gray-100";
  if (s.includes("진행") || s.includes("신건"))
    return "text-amber-700 bg-amber-50";
  if (s.includes("유찰")) return "text-orange-700 bg-orange-50";
  if (s.includes("매각") || s.includes("낙찰"))
    return "text-gray-600 bg-gray-100";
  return "text-gray-500 bg-gray-100";
}

function hasArea(v: number | null): boolean {
  return typeof v === "number" && v > 0;
}

function formatWon(won: number): string {
  if (won >= 100_000_000) {
    const eok = won / 100_000_000;
    return eok >= 10
      ? `${Math.round(eok).toLocaleString()}억`
      : `${eok.toFixed(1)}억`;
  }
  if (won >= 10_000) return `${Math.round(won / 10_000).toLocaleString()}만`;
  return `${won.toLocaleString()}원`;
}

function formatDday(days: number): string {
  if (days > 0) return `D-${days}`;
  if (days === 0) return "D-DAY";
  return `D+${Math.abs(days)}`;
}

function toPyeong(sqm: number): string {
  return Math.round(sqm * 0.3025).toLocaleString();
}

function stripPhone(s: string): string {
  // "(032)320-1133   032-325-0127" → 첫 번호만
  const first = s.split(/\s+/)[0];
  return first.replace(/[^0-9-]/g, "");
}
