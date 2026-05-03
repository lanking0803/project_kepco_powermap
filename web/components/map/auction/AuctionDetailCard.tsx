"use client";

/**
 * 경매 매물 1건 상세 카드 — AuctionTab 안에 인라인 표시.
 *
 * 영업담당자 관점 (의뢰자 의도):
 *   1. 헤더 — 좌:배지/사건명칭/주소 + 우:평당단가/유찰N회 metric chip
 *   2. ⭐ OverviewCard (풀폭) — 감정가→최저가→다음 회차 추정 (의사결정 핵심)
 *   3~6. 짧은 Section 들 (2컬럼 그리드, 모바일은 1컬럼):
 *        🏛 법원 / 담당계
 *        📐 면적 / 단가 (평당단가 + 토지가격비율)
 *        📊 진행 (유찰/낙찰)
 *        🏷 용도 분류 (법원 vs 경매다 — 다를 때만)
 *   7. 상세 펼치기 (lazy) → 사진 + 매각조건(풀폭) + 사건당사자/진행과정/입찰/명도(2컬럼)
 *      + 배당순서(풀폭) + 인근물건/역세권(2컬럼) + 개발계획/주의사항(풀폭)
 *
 * 컨테이너: 모든 Section 은 amber accent 헤더 + 박스. 영업 자료 가독성을 위해
 * 글씨 크기 +1~2px (라벨 12px / 값 13px / 강조 15~22px).
 *
 * 상세 호출은 "상세 펼치기" 버튼 클릭 시에만 (호출 비용 절약 + 빠른 첫 렌더).
 *
 * 스타일: 캠코 OnbidTab 의 DetailCard 미러 — rose → amber 톤 변경.
 */

import { useEffect, useState } from "react";

import { fetchAuctionDetailLazy } from "@/lib/hyphen/detail";
import type {
  AuctionImage,
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
      {/* ── 1. 헤더 — 좌(배지/주소) + 우(metric chip 2개) ── */}
      <AuctionDetailHeader item={item} />

      <div className="p-3 space-y-3">
        {/* ── 2. 영업 OverviewCard (풀폭 — 영업 핵심 강조) ── */}
        <OverviewCard item={item} discountPct={discountPct} />

        {/*
          ── 3~6. 짧은 Section 들 — 데스크톱 2컬럼 / 모바일 1컬럼 ──
          legal 정보, 면적/단가, 진행, 용도 분류는 라벨+값 라인이 적어 빈 공간
          많아 보임. 사이드 패널 폭(~380px) 에서도 2컬럼이 한 줄 30자 내외라
          깨지지 않음. 모바일은 가독성 우선 1컬럼 유지.
        */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-2.5">
          <Section title="🏛 법원 / 담당계">
            <div className="space-y-1">
              <Row label="법원" value={item.법원간략명 || "—"} />
              <Row label="담당계" value={item.담당계 || "—"} />
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
              <Row label="경매번호" value={String(item.경매번호)} mono />
            </div>
          </Section>

          <AreaPriceSection item={item} />

          {(item.유찰수 > 0 ||
            (item.낙찰가 != null && item.낙찰가 > 0)) && (
            <Section title="📊 진행">
              <div className="space-y-1">
                {item.유찰수 > 0 && (
                  <Row label="유찰" value={`${item.유찰수}회`} highlight />
                )}
                {item.낙찰가 != null && item.낙찰가 > 0 && (
                  <Row label="낙찰가" value={formatWon(item.낙찰가)} muted />
                )}
              </div>
            </Section>
          )}

          <YongdoSection item={item} />
        </div>

        {/* ── 7. 상세 펼치기 버튼 ── */}
        <button
          type="button"
          onClick={handleExpand}
          disabled={detailLoading}
          className="w-full text-[13px] font-semibold py-2.5 rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 transition-colors disabled:opacity-60"
        >
          {detailLoading ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 border-2 border-amber-700 border-t-transparent rounded-full animate-spin inline-block" />
              상세 정보 불러오는 중...
            </span>
          ) : expanded ? (
            "상세 정보 접기 ▲"
          ) : (
            "상세 정보 펼치기 (사진 / 권리분석 / 명도비) ▼"
          )}
        </button>

        {/* ── 8. 상세 영역 (expanded + detail 로드된 경우) ── */}
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

// ─── 헤더 (영업 의사결정 요약) ───────────────────────────
//
// 좌측: 진행상태/용도/D-day/사건명칭 + 주소 (식별)
// 우측: 평당단가 chip + 유찰N회 chip (영업 영입 매력 즉시 표시)
//
// 데스크톱 가로 배치, 모바일은 자동으로 줄바꿈 (flex-wrap).

function AuctionDetailHeader({ item }: { item: AuctionListItem }) {
  const perPyeong = pricePerPyeong(item.최저가, item.토지면적);
  return (
    <div className="px-3 py-2.5 bg-amber-50 border-b border-amber-100">
      {/* 1줄: 배지 + 사건명칭 (좌) / metric chips (우) */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <StatusBadge status={item.진행상태} />
          {item.용도 && (
            <span className="text-[11px] text-gray-700 bg-white px-1.5 py-0.5 rounded border border-amber-200">
              {item.용도}
            </span>
          )}
          {item.daysLeft >= -9000 && (
            <span
              className={`text-[11px] font-semibold ${
                item.isUrgent ? "text-red-600" : "text-gray-600"
              }`}
            >
              {formatDday(item.daysLeft)}
            </span>
          )}
          <span className="text-[11px] text-gray-400">·</span>
          <span className="text-[11px] text-gray-500">{item.사건명칭}</span>
        </div>
        {/* 우측 metric chips — 영업 핵심 한눈에 */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {perPyeong != null && (
            <MetricChip
              label="평당"
              value={`${perPyeong.toLocaleString()}만`}
              tone="primary"
            />
          )}
          {item.유찰수 > 0 && (
            <MetricChip
              label="유찰"
              value={`${item.유찰수}회`}
              tone="warning"
            />
          )}
        </div>
      </div>
      <div className="text-[15px] font-bold text-gray-900 leading-tight">
        {item.대표소재지 || item.리스트지번주소}
      </div>
    </div>
  );
}

function MetricChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "primary" | "warning";
}) {
  const cls =
    tone === "primary"
      ? "bg-amber-600 text-white"
      : "bg-orange-100 text-orange-800 border border-orange-200";
  return (
    <div
      className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold whitespace-nowrap ${cls}`}
    >
      <span className="opacity-80 text-[10px]">{label}</span>
      <span className="tabular-nums">{value}</span>
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
  // 다음 회차 추정 — 매각기일 미래(daysLeft >= 0) 일 때만 의미.
  const showNextEstimate = item.daysLeft >= 0 && item.최저가 > 0;
  const nextEstimate = showNextEstimate ? estimateNextLowest(item.최저가) : 0;

  return (
    <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-lg p-3">
      {/* 가격 라인 헤더 — 좌측 라벨 / 우측 매각기일 */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] font-bold text-amber-800 uppercase tracking-wider">
          💰 매각 / 가격
        </div>
        <div className="text-[12px] text-gray-600 tabular-nums">
          {item.매각기일일자 || item.매각기일?.slice(0, 10)}
          {item.매각기일일시 ? ` ${item.매각기일일시}` : ""}
        </div>
      </div>

      {/* 감정가 → 최저가 → 할인율 */}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <div className="text-[11px] text-gray-500">감정가</div>
          <div className="text-[15px] text-gray-700 tabular-nums">
            {formatWon(item.감정가)}
          </div>
        </div>
        <div className="text-gray-400 text-xl pb-0.5">→</div>
        <div className="flex-1">
          <div className="text-[11px] text-gray-500">최저가</div>
          <div className="text-[22px] font-bold text-gray-900 tabular-nums leading-tight">
            {formatWon(item.최저가)}
          </div>
        </div>
        {discountPct > 0 && (
          <div className="text-[26px] font-bold text-red-600 tabular-nums leading-tight">
            -{discountPct}%
          </div>
        )}
      </div>

      {/* 다음 회차 추정 — 매각기일 미래 + 최저가 양수일 때만 */}
      {showNextEstimate && (
        <div className="mt-2.5 pt-2.5 border-t border-amber-200/60">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-gray-600">
              다음 회차 추정<sup className="text-gray-400">*</sup>
            </span>
            <span className="text-[14px] font-semibold text-gray-800 tabular-nums">
              약 {formatWon(nextEstimate)}
              <span className="ml-1 text-[11px] text-red-500 font-normal">
                (-30%)
              </span>
            </span>
          </div>
          <p className="text-[10px] text-gray-400 mt-1 leading-tight">
            * 회차당 -30% 보수 추정. 정확한 다음 회차일/금액은 법원이 매각기일 후 공고
          </p>
        </div>
      )}
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
      {/* 사진 갤러리 — 공매 PhotoGallery 미러 (메인 + 썸네일 + 라이트박스) */}
      {detail.이미지리스트 && detail.이미지리스트.length > 0 && (
        <PhotoGallery images={detail.이미지리스트} />
      )}

      {/* 매각조건 — 풀폭 강조 (예: "맹지" — 영업 의사결정 직결) */}
      {detail.매각조건 && (
        <Section title="⚠️ 매각조건">
          <div className="text-[13px] text-amber-900 font-medium">
            {detail.매각조건}
          </div>
        </Section>
      )}

      {/* 짧은 Section 들 2컬럼 — 사건당사자/진행과정/입찰정보/명도비 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-2.5">
        {/* 사건당사자 */}
        <Section title="👤 사건당사자">
          <div className="space-y-1">
            {detail.소유자 && <Row label="소유자" value={detail.소유자} />}
            {detail.채무자 && <Row label="채무자" value={detail.채무자} />}
            {detail.채권자 && <Row label="채권자" value={detail.채권자} />}
          </div>
        </Section>

        {/* 진행과정 */}
        {detail.진행과정 && (
          <Section title="📅 진행과정">
            <div className="space-y-1">
              {detail.진행과정.경매개시일 && (
                <Row label="개시일" value={detail.진행과정.경매개시일} />
              )}
              {detail.진행과정.감정평가일 && (
                <Row label="감정평가" value={detail.진행과정.감정평가일} />
              )}
              {detail.진행과정.최초경매일 && (
                <Row label="최초경매" value={detail.진행과정.최초경매일} />
              )}
              {detail.진행과정.배당종기일 && (
                <Row label="배당종기" value={detail.진행과정.배당종기일} />
              )}
            </div>
          </Section>
        )}

        {/* 입찰 가격 (포맷 문자열) — Hyphen 응답 그대로 */}
        <Section title="💰 입찰 정보">
          <div className="space-y-1">
            {detail.감정가 && <Row label="감정가" value={detail.감정가} />}
            {detail.최저가 && <Row label="최저가" value={detail.최저가} />}
            {detail.보증금 && <Row label="보증금" value={detail.보증금} />}
            {detail.대지권면적 && (
              <Row label="대지권" value={detail.대지권면적} />
            )}
            {detail.건물면적 && (
              <Row label="건물" value={detail.건물면적} />
            )}
          </div>
        </Section>

        {/* 예상명도비용 */}
        {detail.예상명도비용 &&
          Object.keys(detail.예상명도비용).length > 0 && (
            <Section title="🚪 명도비용">
              <div className="space-y-1">
                {detail.예상명도비용.금액 && (
                  <Row
                    label="총 금액"
                    value={detail.예상명도비용.금액}
                    highlight
                  />
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
                    label="3개월 보관"
                    value={formatWon(detail.예상명도비용.보관비)}
                    muted
                  />
                )}
                {typeof detail.예상명도비용.컨테이너비용 === "number" && (
                  <Row
                    label="컨테이너"
                    value={formatWon(detail.예상명도비용.컨테이너비용)}
                    muted
                  />
                )}
                {detail.예상명도비용.종합 && (
                  <div className="text-[11px] text-gray-500 mt-1.5 leading-tight">
                    {detail.예상명도비용.종합}
                  </div>
                )}
              </div>
            </Section>
          )}
      </div>

      {/* 예상배당순서 — 풀폭 (긴 리스트) */}
      {detail.예상배당순서 && detail.예상배당순서.length > 0 && (
        <Section title="📊 예상 배당순서">
          <div className="space-y-1">
            {detail.예상배당순서.slice(0, 5).map((d, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-2 py-1.5 bg-white rounded border border-amber-100"
              >
                <span className="text-[12px] font-bold w-5 tabular-nums text-amber-700">
                  {d.순번 || `${i + 1}`}
                </span>
                <span className="text-[12px] text-gray-700 truncate flex-1">
                  {d.종류 || "—"} · {d.채권자 || "—"}
                </span>
                <span className="text-[13px] text-gray-900 tabular-nums font-semibold">
                  {d.배당금액 || "—"}
                </span>
              </div>
            ))}
            {detail.예상배당순서.length > 5 && (
              <div className="text-[11px] text-gray-400 text-center pt-0.5">
                ... 외 {detail.예상배당순서.length - 5}건
              </div>
            )}
          </div>
        </Section>
      )}

      {/* 인근물건 + 역세권 — 데스크톱 2컬럼 (둘 다 짧은 리스트) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-2.5">
        {detail.인근물건 && detail.인근물건.length > 0 && (
          <Section title="📍 인근 매물">
            <div className="space-y-1">
              {detail.인근물건.slice(0, 5).map((n, i) => (
                <div
                  key={i}
                  className="px-2 py-1.5 bg-white rounded border border-amber-100"
                >
                  <div className="text-[12px] font-semibold text-gray-800 truncate">
                    {n.인근물건 || "—"}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {n.용도 || ""} · {n.매각기일 || ""} · 감정 {n.감정가 || "—"}
                  </div>
                </div>
              ))}
              {detail.인근물건.length > 5 && (
                <div className="text-[11px] text-gray-400 text-center pt-0.5">
                  ... 외 {detail.인근물건.length - 5}건
                </div>
              )}
            </div>
          </Section>
        )}

        {detail.역세권 && detail.역세권.length > 0 && (
          <Section title="🚇 역세권">
            <div className="space-y-1">
              {detail.역세권.slice(0, 5).map((s, i) => (
                <div key={i} className="flex items-center gap-2 px-1">
                  <span className="text-[11px] text-gray-500 w-12 truncate">
                    {s.노선명 || "—"}
                  </span>
                  <span className="text-[12px] font-semibold flex-1 truncate text-gray-800">
                    {s.역명 || "—"}
                  </span>
                  <span className="text-[12px] text-gray-500 tabular-nums">
                    {typeof s.거리 === "number"
                      ? `${(s.거리 / 1000).toFixed(1)}km`
                      : "—"}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>

      {/* 개발계획 — 풀폭 (외부 링크 + 긴 텍스트) */}
      {detail.개발계획 && detail.개발계획.length > 0 && (
        <Section title="🏗 개발계획 (국토부 LURIS)">
          <div className="space-y-1">
            {detail.개발계획.slice(0, 3).map((d, i) => (
              <a
                key={i}
                href={d.URL || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-2 py-1.5 bg-white rounded border border-amber-100 hover:border-amber-300 transition-colors"
              >
                <div className="text-[12px] font-semibold truncate text-amber-800">
                  {d.SUBJECT || d.법정명 || "—"}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {d.GUBUN || ""} · {d.OPENDATE || ""}
                </div>
              </a>
            ))}
          </div>
        </Section>
      )}

      {/* 하단주의사항 — 풀폭 (긴 안내문) */}
      {(detail.하단주의사항_01 ||
        detail.하단주의사항_02 ||
        detail.하단주의사항_03) && (
        <Section title="⚠️ 주의사항">
          <div className="text-[12px] text-gray-600 space-y-1.5 leading-relaxed">
            {detail.하단주의사항_01 && <p>{detail.하단주의사항_01}</p>}
            {detail.하단주의사항_02 && <p>{detail.하단주의사항_02}</p>}
            {detail.하단주의사항_03 && <p>{detail.하단주의사항_03}</p>}
          </div>
        </Section>
      )}
    </>
  );
}

// ─── 사진 갤러리 — 메인 + 썸네일 + 라이트박스 ─────────────
//
// 공매 OnbidTab.PhotoGallery 미러. rose → amber 톤 변경.
//
// 이미지 호스트 = filelab.co.kr (실호출 검증 2026-05-03).
// Hyphen 명세는 "auctionall.co.kr + 사진경로" 라고 적혀있지만 그쪽은 404.
// auctionall.co.kr 의 자체 페이지가 이미지를 filelab.co.kr 에서 불러옴.
// filelab.co.kr 는 정상 HTTPS + Access-Control-Allow-Origin: * → 브라우저 직접 호출 가능.

const HYPHEN_IMAGE_HOST = "https://filelab.co.kr";

function buildAuctionImageUrl(img: AuctionImage): string {
  const path = img.사진경로.endsWith("/")
    ? img.사진경로
    : `${img.사진경로}/`;
  const file = img.파일명.startsWith("/")
    ? img.파일명.slice(1)
    : img.파일명;
  return `${HYPHEN_IMAGE_HOST}${path}${file}`;
}

function PhotoGallery({ images }: { images: AuctionImage[] }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const urls = images.map(buildAuctionImageUrl);

  return (
    <div>
      <div className="text-[10px] md:text-[11px] font-bold text-gray-500 mb-1.5 tracking-wider uppercase">
        📷 사진 ({images.length})
      </div>
      {/* 메인 사진 — 클릭 시 라이트박스 */}
      <div className="aspect-video bg-gray-100 rounded-md overflow-hidden mb-1.5 relative group">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={urls[activeIdx]}
          alt={images[activeIdx].사진설명 || `매물 사진 ${activeIdx + 1}`}
          className="w-full h-full object-contain cursor-zoom-in"
          loading="lazy"
          referrerPolicy="no-referrer"
          onClick={() => setLightbox(true)}
        />
        {urls.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveIdx((i) => (i - 1 + urls.length) % urls.length);
              }}
              className="absolute left-1 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/40 hover:bg-black/60 text-white rounded-full text-sm"
              aria-label="이전 사진"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveIdx((i) => (i + 1) % urls.length);
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/40 hover:bg-black/60 text-white rounded-full text-sm"
              aria-label="다음 사진"
            >
              ▶
            </button>
            <span className="absolute right-2 bottom-2 px-2 py-0.5 bg-black/60 text-white text-[10px] rounded">
              {activeIdx + 1} / {urls.length}
            </span>
          </>
        )}
        <span className="absolute left-2 bottom-2 px-2 py-0.5 bg-black/60 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity">
          🔍 클릭으로 확대
        </span>
      </div>
      {/* 썸네일 가로 스크롤 — 사진 2장 이상일 때만 */}
      {urls.length > 1 && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {urls.map((url, i) => (
            <button
              key={`${images[i].이미지일련번호}-${i}`}
              type="button"
              onClick={() => setActiveIdx(i)}
              className={`flex-shrink-0 w-12 h-12 rounded overflow-hidden border-2 transition-colors ${
                i === activeIdx ? "border-amber-500" : "border-transparent"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`썸네일 ${i + 1}`}
                className="w-full h-full object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            </button>
          ))}
        </div>
      )}

      {lightbox && (
        <PhotoLightbox
          urls={urls}
          captions={images.map((im) => im.사진설명 || "")}
          startIdx={activeIdx}
          onClose={(lastIdx) => {
            setActiveIdx(lastIdx);
            setLightbox(false);
          }}
        />
      )}
    </div>
  );
}

// ─── 라이트박스 — 풀스크린 사진 뷰어 ───────────────────────
//   ESC / 배경 클릭 / X 버튼 닫음. ◀▶ 키보드/클릭 네비.
//   공매 OnbidTab.PhotoLightbox 미러.

function PhotoLightbox({
  urls,
  captions,
  startIdx,
  onClose,
}: {
  urls: string[];
  captions: string[];
  startIdx: number;
  onClose: (lastIdx: number) => void;
}) {
  const [idx, setIdx] = useState(startIdx);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose(idx);
      } else if (e.key === "ArrowLeft") {
        setIdx((i) => (i - 1 + urls.length) % urls.length);
      } else if (e.key === "ArrowRight") {
        setIdx((i) => (i + 1) % urls.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [urls.length, onClose, idx]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={() => onClose(idx)}
    >
      <div
        className="absolute inset-x-4 top-20 bottom-20 flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={urls[idx]}
          alt={captions[idx] || `매물 사진 ${idx + 1}`}
          className="w-full h-full object-contain"
          referrerPolicy="no-referrer"
        />
      </div>
      {urls.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIdx((i) => (i - 1 + urls.length) % urls.length);
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-black/50 hover:bg-black/70 text-white rounded-full text-xl z-10 flex items-center justify-center"
            aria-label="이전 사진"
          >
            ◀
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIdx((i) => (i + 1) % urls.length);
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-black/50 hover:bg-black/70 text-white rounded-full text-xl z-10 flex items-center justify-center"
            aria-label="다음 사진"
          >
            ▶
          </button>
          <span className="absolute bottom-6 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/60 text-white text-sm rounded z-10">
            {idx + 1} / {urls.length}
          </span>
        </>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose(idx);
        }}
        className="absolute top-4 right-4 w-10 h-10 bg-black/60 hover:bg-black/80 text-white rounded-full text-xl z-10 flex items-center justify-center"
        aria-label="닫기"
      >
        ×
      </button>
    </div>
  );
}

// ─── 면적 / 단가 Section ──────────────────────────────────
//
// 영업담당자 의식 흐름: "이 매물 평당 얼마인가" 가 시세 비교 핵심 지표.
// 토지면적이 있을 때만 표시 (건물 단독 매물은 평당 단가 의미 X).

function AreaPriceSection({ item }: { item: AuctionListItem }) {
  const landSqm = item.토지면적;
  const bldgSqm = item.건물면적;
  const showLand = hasArea(landSqm);
  const showBldg = hasArea(bldgSqm);
  const perPyeong = pricePerPyeong(item.최저가, landSqm);
  const showLandRatio =
    typeof item.토지가격비율 === "number" && item.토지가격비율 > 0;

  if (!showLand && !showBldg) return null;

  return (
    <Section title="📐 면적 / 단가">
      <div className="text-xs text-gray-700 space-y-1">
        {showLand && (
          <Row
            label="토지"
            value={`${landSqm!.toLocaleString()} ㎡ (${toPyeong(landSqm!)}평)`}
          />
        )}
        {showBldg && (
          <Row
            label="건물"
            value={`${bldgSqm!.toLocaleString()} ㎡ (${toPyeong(bldgSqm!)}평)`}
          />
        )}
        {(perPyeong != null || showLandRatio) && (
          <div className="border-t border-gray-100 mt-1.5 pt-1.5 space-y-1">
            {perPyeong != null && (
              <Row
                label="평당 단가"
                value={`약 ${perPyeong.toLocaleString()}만원/평`}
                highlight
              />
            )}
            {showLandRatio && (
              <Row
                label="토지가격비율"
                value={`${Math.round(item.토지가격비율)}%`}
                muted
              />
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

// ─── 용도 분류 Section ────────────────────────────────────
//
// Hyphen 응답:
//   - 용도        : 법원 분류 (헤더 배지에 이미 표시)
//   - 법원용도    : 보통 `용도` 와 동일
//   - 경매다용도  : Hyphen 영업용 분류 (없을 수 있음)
//
// 헤더 배지로 이미 `용도` 를 보여주고 있어서, **다를 때만** Section 표시.
// 법원/경매다 분류가 같으면 노이즈 — 굳이 안 보임.

function YongdoSection({ item }: { item: AuctionListItem }) {
  const courtUse = item.법원용도 || item.용도 || "";
  const auctionDaUse = item.경매다용도 || "";
  // 둘 다 있고 서로 다른 경우만 의미 있음
  if (!courtUse || !auctionDaUse || courtUse === auctionDaUse) return null;
  return (
    <Section title="🏷 용도 분류">
      <div className="text-xs text-gray-700 space-y-1">
        <Row label="법원 용도" value={courtUse} />
        <Row label="경매다 분류" value={auctionDaUse} />
      </div>
    </Section>
  );
}

// ─── 헬퍼 컴포넌트 ────────────────────────────────────────

/**
 * Section — 정보 그룹 컨테이너.
 *
 * amber accent 좌측 보더 + 연한 배경 → 한 묶음임을 시각적으로 명확히.
 * 같은 폭 안에서 다른 Section 과 자연스러운 간격 (parent gap-y-3 으로).
 *
 * 글씨 크기:
 *   - 타이틀 13px 세미볼드 (영업 자료 가독성 우선)
 *   - 본문은 자식이 책임 (Row 컴포넌트가 13px 기준)
 */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-amber-100 bg-amber-50/30 overflow-hidden">
      <div className="px-2.5 py-1.5 bg-amber-100/40 border-b border-amber-100 text-[12px] font-semibold text-amber-900">
        {title}
      </div>
      <div className="px-2.5 py-2">{children}</div>
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
      <span className="text-[12px] text-gray-500 w-16 shrink-0">{label}</span>
      <span
        className={`text-[13px] ${
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

/**
 * 다음 회차 추정 최저가.
 *
 * 한국 법원 경매 회차당 감액률은 법원/사건별로 다르지만,
 * 대부분 -20% 또는 -30% (지방법원에 따라). 보수적으로 -30% 적용.
 *
 * 실제 정확값은 detail 응답의 `기일리스트` 에 있지만, 목록 카드는
 * detail 호출 전이라 추정만 가능. UI 에 "추정" 명시.
 */
const NEXT_ROUND_RATIO = 0.7;

function estimateNextLowest(currentLowest: number): number {
  return Math.round((currentLowest * NEXT_ROUND_RATIO) / 10000) * 10000;
}

/**
 * 평당 단가 (만원/평).
 * 토지면적 기준 (건물면적 무시 — 영업담당자는 토지 단가 기준 거래).
 * 토지면적 0/null 이면 null.
 */
function pricePerPyeong(lowest: number, landSqm: number | null): number | null {
  if (!landSqm || landSqm <= 0) return null;
  const pyeong = landSqm * 0.3025;
  if (pyeong < 0.5) return null;
  return Math.round(lowest / pyeong / 10000); // 만원 단위
}

function stripPhone(s: string): string {
  // "(032)320-1133   032-325-0127" → 첫 번호만
  const first = s.split(/\s+/)[0];
  return first.replace(/[^0-9-]/g, "");
}
