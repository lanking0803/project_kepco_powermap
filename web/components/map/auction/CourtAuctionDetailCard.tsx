"use client";

/**
 * 법원경매 채널 전용 매물 1건 상세 카드.
 *
 * 의뢰자 결정 (2026-05-04):
 *   - hyphen 형 매핑 강요 X — court raw 12 섹션을 직접 활용해 풍부 UI 구성
 *   - 영업담당자 시각 우선 (가격/유찰/매각기일/담당계 연락처)
 *   - 스타일은 hyphen AuctionDetailCard 와 동일한 amber 톤 / Section / Row 패턴
 *
 * 데이터 소스:
 *   1. AuctionListItem (목록 호출 결과) — 헤더 / 가격 OverviewCard / 면적
 *   2. CourtRawDetailItem (lazy 펼치기) — 12 섹션 풍부 정보
 *      - dma_csBasInf (사건기본 + 담당계 연락처 + 청구금액)
 *      - dlt_dspslGdsDspslObjctLst (물건내역 — 회차별 최저가/공고기간/입찰보증금률)
 *      - dlt_rletCsGdsDtsDxdyInf (회차별 기일 이력 — 진행/유찰/매각)
 *      - dlt_rletCsIntrpsLst (당사자 — 9~10명 풍부)
 *      - dlt_dstrtDemnLstprdDts (배당요구종기)
 *      - dlt_rletReltCsLst / dlt_dpcnMrgTrnscsCsRlet (관련/중복 사건 — 0건일 때 미표시)
 *
 * court detail 에 없는 것 (영업 시작 단계엔 불필요 — 의뢰자 결정):
 *   - 사진 / 감정평가서 PDF / 임차인현황 / 등기부 / 인근물건 / 역세권 / 개발계획
 */

import { useState } from "react";

import { composeJibunAddrFromDetailGoods } from "@/lib/court-auction/adapter";
import { fetchCourtDetailLazy } from "@/lib/court-auction/detail-fetch";
import type {
  CourtApiStatus,
  CourtRawDetailItem,
} from "@/lib/court-auction/types";
import { formatWon } from "@/lib/format/won";
import { jibunFromPnu } from "@/lib/geo/pnu";
import type { AuctionListItem } from "@/lib/hyphen/types";

import ApiStatusBanner from "./ApiStatusBanner";

export default function CourtAuctionDetailCard({
  item,
}: {
  item: AuctionListItem;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<CourtRawDetailItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailStatus, setDetailStatus] = useState<CourtApiStatus>("ok");
  const [detailErrMsg, setDetailErrMsg] = useState("");

  const courtKey = item.courtCaseKey;

  async function handleExpand() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (detail) return; // 이미 로드됨

    if (!courtKey || !courtKey.cortOfcCd || !courtKey.csNo) {
      setDetailStatus("unavailable");
      setDetailErrMsg("사건키 누락 — 법원경매 채널이 아닙니다");
      return;
    }

    setDetailLoading(true);
    try {
      const res = await fetchCourtDetailLazy(courtKey.cortOfcCd, courtKey.csNo);
      setDetailStatus(res.apiStatus);
      setDetailErrMsg(res.errMsg);
      setDetail(res.detail);
    } catch (e) {
      console.error("[CourtAuctionDetailCard] 상세 호출 실패", e);
      setDetailStatus("unavailable");
      setDetailErrMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  }

  const discountPct = Math.round(item.discountRatio * 100);

  return (
    <div className="border border-amber-200 rounded-lg overflow-hidden bg-white">
      {/* 헤더 — 배지/사건명/주소 + 평당 metric */}
      <CardHeader item={item} />

      <div className="p-3 space-y-3">
        {/* 영업 OverviewCard — 풀폭 강조 */}
        <OverviewCard item={item} discountPct={discountPct} />

        {/* 짧은 Section 들 — 데스크톱 2컬럼 / 모바일 1컬럼 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-2.5">
          <CourtSection item={item} />
          <AreaSection item={item} />
          <ProgressSection item={item} />
          <ClassSection item={item} />
        </div>

        {/* 상세 펼치기 버튼 */}
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
            "상세 정보 펼치기 (담당계 연락처 / 당사자 / 회차이력) ▼"
          )}
        </button>

        {/* 상세 영역 — 비정상 응답 배너 */}
        {expanded && detailStatus !== "ok" && (
          <CourtApiStatusBanner
            apiStatus={detailStatus}
            errMsg={detailErrMsg}
          />
        )}

        {/* 상세 영역 — 12 섹션 풍부 표시 */}
        {expanded && detail && (
          <DetailExtra detail={detail} clickedItem={item} />
        )}
      </div>
    </div>
  );
}

// ─── 헤더 ──────────────────────────────────────────────────

function CardHeader({ item }: { item: AuctionListItem }) {
  const perPyeong = pricePerPyeong(item.최저가, item.토지면적);
  return (
    <div className="px-3 py-2.5 bg-amber-50 border-b border-amber-100">
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

// ─── OverviewCard ─────────────────────────────────────────

function OverviewCard({
  item,
  discountPct,
}: {
  item: AuctionListItem;
  discountPct: number;
}) {
  const showNextEstimate = item.daysLeft >= 0 && item.최저가 > 0;
  const nextEstimate = showNextEstimate ? estimateNextLowest(item.최저가) : 0;

  return (
    <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] font-bold text-amber-800 uppercase tracking-wider">
          💰 매각 / 가격
        </div>
        <div className="text-[12px] text-gray-600 tabular-nums">
          {item.매각기일일자 || item.매각기일?.slice(0, 10)}
          {item.매각기일일시 ? ` ${item.매각기일일시}` : ""}
        </div>
      </div>

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

      {/* 회차별 가격 이력 — 영업 시각: 가격 하락 추이 */}
      {item.회차별최저가 && item.회차별최저가.length > 1 && (
        <div className="mt-2.5 pt-2.5 border-t border-amber-200/60">
          <div className="text-[11px] font-semibold text-amber-800 mb-1.5">
            📉 회차별 최저가
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {item.회차별최저가.map((r) => (
              <div
                key={r.회차}
                className="flex items-center gap-1 bg-white border border-amber-200 rounded px-1.5 py-0.5"
              >
                <span className="text-[10px] text-gray-500 font-semibold">
                  {r.회차}회
                </span>
                <span className="text-[12px] tabular-nums text-gray-900">
                  {formatWon(r.가격)}
                </span>
                {r.감정대비비율 != null && (
                  <span className="text-[10px] text-amber-600 tabular-nums">
                    ({r.감정대비비율}%)
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
            * 회차당 -30% 보수 추정. 정확한 다음 회차 금액은 법원이 매각기일 후 공고
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Section 들 (목록 데이터만으로 표시) ───────────────────

function CourtSection({ item }: { item: AuctionListItem }) {
  return (
    <Section title="🏛 법원 / 담당계">
      <div className="space-y-1">
        <Row label="법원" value={item.법원간략명 || "—"} />
        <Row label="담당계" value={item.담당계 || "—"} />
        <Row label="사건번호" value={item.사건명칭} mono />
      </div>
    </Section>
  );
}

function AreaSection({ item }: { item: AuctionListItem }) {
  const landSqm = item.토지면적;
  const bldgSqm = item.건물면적;
  const showLand = hasArea(landSqm);
  const showBldg = hasArea(bldgSqm);
  const perPyeong = pricePerPyeong(item.최저가, landSqm);

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
        {perPyeong != null && (
          <div className="border-t border-gray-100 mt-1.5 pt-1.5">
            <Row
              label="평당 단가"
              value={`약 ${perPyeong.toLocaleString()}만원/평`}
              highlight
            />
          </div>
        )}
      </div>
    </Section>
  );
}

function ProgressSection({ item }: { item: AuctionListItem }) {
  if (item.유찰수 === 0) return null;
  return (
    <Section title="📊 진행">
      <div className="space-y-1">
        <Row label="유찰" value={`${item.유찰수}회`} highlight />
      </div>
    </Section>
  );
}

function ClassSection({ item }: { item: AuctionListItem }) {
  if (!item.groupBreakdown) return null;
  const { land, building, aggregate } = item.groupBreakdown;
  const parts: string[] = [];
  if (land > 0) parts.push(`토지 ${land}건`);
  if (building > 0) parts.push(`건물 ${building}건`);
  if (aggregate > 0) parts.push(`집합 ${aggregate}건`);
  if (parts.length === 0) return null;
  return (
    <Section title="🏷 매물 구성">
      <div className="text-[13px] text-gray-700">{parts.join(" · ")}</div>
    </Section>
  );
}

// ─── 상세 영역 (lazy 로드 후 — court 12 섹션 풍부 표시) ───

function DetailExtra({
  detail,
  clickedItem,
}: {
  detail: CourtRawDetailItem;
  clickedItem: AuctionListItem;
}) {
  // 클릭한 지번 추출 — pnuStandard 에서 사람이 읽는 지번 형태("252-16", "산148-1")
  const clickedLotno = clickedItem.pnuStandard
    ? (jibunFromPnu(clickedItem.pnuStandard) ?? "")
    : "";

  return (
    <>
      {/* 청구금액 vs 최저가 인사이트 — 영업 의사결정 핵심 */}
      <ClaimVsLowestInsight
        bas={detail.dma_csBasInf}
        lowest={clickedItem.최저가}
      />

      {/* 사건 기본 정보 — 담당계 전화 + 접수/명령일 */}
      <BasicInfoSection bas={detail.dma_csBasInf} />

      {/* 물건내역 — 토글로 [이 지번만] vs [사건 전체] 전환 */}
      <GoodsSection
        list={detail.dlt_dspslGdsDspslObjctLst ?? []}
        clickedLotno={clickedLotno}
        clickedItem={clickedItem}
      />

      {/* 매각 조건 — 사건 단위 1번 표시 (보증금률/공고기간) */}
      <SaleConditionSection list={detail.dlt_dspslGdsDspslObjctLst ?? []} />

      {/* 회차 기일 이력 */}
      <DxdyHistorySection list={detail.dlt_rletCsGdsDtsDxdyInf ?? []} />

      {/* 2컬럼 — 당사자 + 배당요구종기 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-2.5">
        <PartiesSection list={detail.dlt_rletCsIntrpsLst ?? []} />
        <DistributionSection list={detail.dlt_dstrtDemnLstprdDts ?? []} />
      </div>

      {/* 관련 사건 / 중복병합 — 있을 때만 */}
      {(detail.dlt_rletReltCsLst?.length ?? 0) > 0 && (
        <RelatedCasesSection list={detail.dlt_rletReltCsLst!} />
      )}
      {(detail.dlt_dpcnMrgTrnscsCsRlet?.length ?? 0) > 0 && (
        <MergedCasesSection list={detail.dlt_dpcnMrgTrnscsCsRlet!} />
      )}
    </>
  );
}

// ─── 청구금액 vs 최저가 인사이트 ──────────────────────────
//
// 영업 시각:
//   - 최저가 ≥ 청구금액  → "잉여 매각 가능성" — 채권자 다 변제 + 소유자에 잔액
//   - 최저가 < 청구금액  → "부족 매각 가능성" — 채권자 일부만 변제 (인수 권리 잔존 위험)
// 이 차이는 매수자 입장에서 권리분석 단서.

function ClaimVsLowestInsight({
  bas,
  lowest,
}: {
  bas: CourtRawDetailItem["dma_csBasInf"];
  lowest: number;
}) {
  if (!bas || typeof bas.clmAmt !== "number" || bas.clmAmt <= 0) return null;
  if (!lowest || lowest <= 0) return null;

  const claim = bas.clmAmt;
  const surplus = lowest - claim; // 양수: 잉여, 음수: 부족
  const isSurplus = surplus >= 0;
  const ratio = (lowest / claim) * 100;

  return (
    <Section title="🧮 권리분석 단서">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-gray-500">청구금액</span>
          <span className="text-[13px] font-semibold text-gray-900 tabular-nums">
            {formatWon(claim)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-gray-500">최저가</span>
          <span className="text-[13px] font-semibold text-gray-900 tabular-nums">
            {formatWon(lowest)}
          </span>
        </div>
        <div className="border-t border-amber-100 pt-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-gray-500">
              {isSurplus ? "잉여 추정" : "부족 추정"}
            </span>
            <span
              className={`text-[14px] font-bold tabular-nums ${
                isSurplus ? "text-emerald-700" : "text-rose-600"
              }`}
            >
              {isSurplus ? "+" : "−"}
              {formatWon(Math.abs(surplus))}
              <span className="ml-1 text-[10px] font-normal opacity-70">
                ({Math.round(ratio)}%)
              </span>
            </span>
          </div>
          <p className="text-[10px] text-gray-400 mt-1 leading-tight">
            {isSurplus
              ? "* 최저가 기준 채권 변제 후 잉여 가능 — 권리관계 단순할 가능성"
              : "* 최저가가 청구금액 미달 — 인수 권리/추가 채권 확인 필요"}
          </p>
        </div>
      </div>
    </Section>
  );
}

// ─── 사건 기본 정보 ───────────────────────────────────────

function BasicInfoSection({
  bas,
}: {
  bas: CourtRawDetailItem["dma_csBasInf"];
}) {
  if (!bas) return null;
  const phones = composePhones(bas.jdbnTelno, bas.execrCsTelno);
  return (
    <Section title="🏛 사건 기본">
      <div className="space-y-1">
        <Row label="사건명" value={bas.csNm || "—"} />
        <Row label="법원" value={bas.cortOfcNm || bas.cortSptNm || "—"} />
        <Row label="담당계" value={bas.cortAuctnJdbnNm || "—"} />
        {phones.length > 0 && (
          <div className="space-y-0.5">
            {phones.map((p, i) => (
              <Row
                key={i}
                label={i === 0 ? "전화" : ""}
                value={
                  <a
                    href={`tel:${p.tel}`}
                    className="text-amber-700 hover:underline"
                  >
                    {p.label ? `${p.label} ` : ""}
                    {p.tel}
                  </a>
                }
              />
            ))}
          </div>
        )}
        {bas.csRcptYmd && (
          <Row label="접수일" value={formatYmdDash(bas.csRcptYmd) || "—"} />
        )}
        {bas.csCmdcYmd && (
          <Row label="개시일" value={formatYmdDash(bas.csCmdcYmd) || "—"} />
        )}
        {/* 청구금액은 위 "권리분석 단서" 섹션에 표시 (최저가 비교) */}
      </div>

      {/* 법원경매 사이트 바로가기 — POST 폼이라 자동 입력 불가, 안내만 */}
      <CourtSiteShortcut
        cortOfcNm={bas.cortOfcNm || bas.cortSptNm || ""}
        userCsNo={bas.userCsNo || ""}
      />
    </Section>
  );
}

/**
 * 법원경매 사이트(courtauction.go.kr) 사건검색 바로가기 + 입력 가이드.
 *
 * 사이트가 POST 폼이라 URL 파라미터로 자동 입력 불가 →
 * 사용자가 법원/사건번호 직접 입력해야 함.
 * 영업 편의:
 *   - 사건번호 클릭 → 클립보드 복사
 *   - "법원경매 사이트 열기" 버튼 → 새 탭
 *   - 입력 가이드 한 줄 표시
 */
function CourtSiteShortcut({
  cortOfcNm,
  userCsNo,
}: {
  cortOfcNm: string;
  userCsNo: string;
}) {
  const [copied, setCopied] = useState<"court" | "case" | null>(null);

  if (!userCsNo) return null;

  // userCsNo = "2025타경102824" 형식 — "타경" 분리
  const m = userCsNo.match(/^(\d{4})타경(\d+)$/);
  const csYear = m?.[1] ?? "";
  const csNum = m?.[2] ?? "";

  async function copyToClipboard(text: string, kind: "court" | "case") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch (e) {
      console.error("[CourtSiteShortcut] 복사 실패", e);
    }
  }

  return (
    <div className="mt-2 pt-2 border-t border-amber-100 space-y-1.5">
      <div className="text-[11px] font-semibold text-amber-800">
        🔗 법원경매 사이트 직접 조회
      </div>
      <p className="text-[11px] text-gray-600 leading-relaxed">
        아래 정보로 법원경매 사이트에서 직접 조회하세요. 클릭 시 복사됩니다.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {cortOfcNm && (
          <button
            type="button"
            onClick={() => copyToClipboard(cortOfcNm, "court")}
            className="text-[11px] px-2 py-1 bg-white border border-amber-200 hover:bg-amber-50 rounded transition-colors"
            title="법원명 복사"
          >
            <span className="text-gray-500">법원</span>{" "}
            <span className="font-semibold text-gray-900">{cortOfcNm}</span>
            <span className="ml-1 text-[10px] text-amber-600">
              {copied === "court" ? "✓ 복사됨" : "📋"}
            </span>
          </button>
        )}
        {csYear && csNum && (
          <button
            type="button"
            onClick={() => copyToClipboard(userCsNo, "case")}
            className="text-[11px] px-2 py-1 bg-white border border-amber-200 hover:bg-amber-50 rounded transition-colors tabular-nums"
            title="사건번호 복사"
          >
            <span className="text-gray-500">사건</span>{" "}
            <span className="font-semibold text-gray-900">{userCsNo}</span>
            <span className="ml-1 text-[10px] text-amber-600">
              {copied === "case" ? "✓ 복사됨" : "📋"}
            </span>
          </button>
        )}
      </div>
      <a
        href="https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ159M00.xml"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded font-semibold transition-colors"
      >
        법원경매 사이트 열기
        <span className="text-[10px]">↗</span>
      </a>
      {csYear && csNum && (
        <p className="text-[10px] text-gray-500 leading-tight">
          사이트에서 <b>법원 = {cortOfcNm}</b>, <b>사건번호 = {csYear} 타경 {csNum}</b> 입력
        </p>
      )}
    </div>
  );
}

// ─── 물건 내역 (N개 매물) ────────────────────────────────

function GoodsSection({
  list,
  clickedLotno,
  clickedItem,
}: {
  list: CourtRawDetailItem["dlt_dspslGdsDspslObjctLst"];
  clickedLotno: string;
  clickedItem: AuctionListItem;
}) {
  // 클릭 지번 row 만 / 사건 전체 row — 둘 다 후처리, API 호출 0
  const matchedThis = clickedLotno
    ? list.filter((g) => g.rprsLtnoAddr === clickedLotno)
    : [];
  const totalCount = list.length;
  const thisCount = matchedThis.length;

  // 토글 표시 조건:
  //   - 클릭 지번 매칭 ≥1 건 + 사건 전체에 다른 row 도 존재 → 토글 의미 있음
  //   - 매칭 0건이거나 사건 전체가 1건뿐 → 토글 숨김 (전체 표시)
  const showToggle = thisCount > 0 && thisCount < totalCount;

  // 기본값 — 클릭 지번 (PNU 중심 일관성)
  const [mode, setMode] = useState<"this" | "all">(
    showToggle ? "this" : "all",
  );
  const visible = mode === "this" && thisCount > 0 ? matchedThis : list;
  const isThisMode = mode === "this" && thisCount > 0;

  if (!list || list.length === 0) return null;
  return (
    <Section
      title={
        <span className="flex items-center justify-between gap-2 w-full">
          <span>
            📦 매각 자산 ({mode === "this" ? thisCount : totalCount}건)
          </span>
          {showToggle && (
            <span className="inline-flex rounded-md overflow-hidden border border-amber-200 text-[10px] font-semibold">
              <button
                type="button"
                onClick={() => setMode("this")}
                className={`px-2 py-0.5 transition-colors ${
                  mode === "this"
                    ? "bg-amber-600 text-white"
                    : "bg-white text-amber-700 hover:bg-amber-50"
                }`}
              >
                이 지번 ({thisCount})
              </button>
              <button
                type="button"
                onClick={() => setMode("all")}
                className={`px-2 py-0.5 transition-colors ${
                  mode === "all"
                    ? "bg-amber-600 text-white"
                    : "bg-white text-amber-700 hover:bg-amber-50"
                }`}
              >
                사건 전체 ({totalCount})
              </button>
            </span>
          )}
        </span>
      }
    >
      <div className="space-y-1">
        {visible.map((g, i) => (
          <GoodsRow
            key={`${g.dspslObjctSeq}-${i}`}
            g={g}
            // "이 지번" 모드일 때만 클릭 매물의 면적/지목 정보 표시 가능
            // (사건 전체 모드면 자산별 면적은 raw 에 없음 — 분류/지번만 표시)
            extra={isThisMode ? extractAssetExtra(g, clickedItem) : null}
          />
        ))}
      </div>
    </Section>
  );
}

/**
 * 매각 자산 한 줄 — 분류 배지 + 지번주소 + (이 지번 모드면) 면적/지목.
 * 가격/매각기일/유찰/보증금/공고기간 은 사건 단위 정보라 OverviewCard / SaleConditionSection 에 1번 표시.
 */
function GoodsRow({
  g,
  extra,
}: {
  g: CourtRawDetailItem["dlt_dspslGdsDspslObjctLst"][number];
  extra: { area: string; jimok: string } | null;
}) {
  const addr = composeJibunAddrFromDetailGoods(g);
  return (
    <div className="px-2.5 py-1.5 bg-white rounded border border-amber-100 flex items-center gap-2 text-[12px]">
      <ObjectKindBadge code={g.auctnLstDvsCd} />
      <span className="text-gray-800 truncate flex-1">{addr}</span>
      {extra?.jimok && (
        <span className="text-[11px] text-gray-500 flex-shrink-0">
          {extra.jimok}
        </span>
      )}
      {extra?.area && (
        <span className="text-[11px] text-gray-700 tabular-nums flex-shrink-0">
          {extra.area}
        </span>
      )}
    </div>
  );
}

/**
 * "이 지번" 모드에서 클릭 매물의 면적/지목 추출.
 *  - 클릭한 row(g) 가 토지(01)면: 토지면적 + 지목
 *  - 건물(02)이면: 건물면적
 * AuctionListItem 의 토지면적/건물면적/법원용도 (목록 raw 의 areaList/jimokList 에서 어댑터가 박은 값) 활용.
 */
function extractAssetExtra(
  g: CourtRawDetailItem["dlt_dspslGdsDspslObjctLst"][number],
  item: AuctionListItem,
): { area: string; jimok: string } {
  const isLand = g.auctnLstDvsCd === "01";
  const isBuilding = g.auctnLstDvsCd === "02";
  const sqm = isLand ? item.토지면적 : isBuilding ? item.건물면적 : null;
  const area =
    sqm != null && sqm > 0
      ? `${Math.round(sqm).toLocaleString()}㎡ (${Math.round(sqm * 0.3025).toLocaleString()}평)`
      : "";
  // 지목은 토지일 때만 의미 있음. 법원용도 필드에 박혀있음 ("대지,임야,전답" 등)
  const jimok = isLand && item.법원용도 ? item.법원용도 : "";
  return { area, jimok };
}

/**
 * 매각 조건 섹션 — 사건 단위 공통 정보 1번 표시.
 * 보증금률, 공고기간 (자산별로 다 같은 값이므로 첫 row 기준 1번만).
 */
function SaleConditionSection({
  list,
}: {
  list: CourtRawDetailItem["dlt_dspslGdsDspslObjctLst"];
}) {
  if (!list || list.length === 0) return null;
  const g = list[0];
  const hasDeposit = typeof g.prchDposRate === "number" && g.prchDposRate > 0;
  const hasPeriod = !!(g.pstgBgngYmd && g.pstgEndYmd);
  if (!hasDeposit && !hasPeriod) return null;
  return (
    <Section title="💼 매각 조건">
      <div className="space-y-1">
        {hasDeposit && (
          <Row label="보증금률" value={`${g.prchDposRate}%`} highlight />
        )}
        {hasPeriod && (
          <Row
            label="공고기간"
            value={`${formatYmdDash(g.pstgBgngYmd)} ~ ${formatYmdDash(g.pstgEndYmd)}`}
            muted
          />
        )}
      </div>
    </Section>
  );
}

// ─── 회차 기일 이력 ──────────────────────────────────────

function DxdyHistorySection({
  list,
}: {
  list: CourtRawDetailItem["dlt_rletCsGdsDtsDxdyInf"];
}) {
  if (!list || list.length === 0) return null;
  return (
    <Section title={`📅 회차 기일 (${list.length}건)`}>
      <div className="space-y-1">
        {list.map((d, i) => (
          <div
            key={`${d.dxdyYmd}-${i}`}
            className="flex items-center gap-2 px-2 py-1.5 bg-white rounded border border-amber-100"
          >
            <span className="text-[11px] font-bold w-5 tabular-nums text-amber-700">
              {i + 1}
            </span>
            <span className="text-[12px] text-gray-700 tabular-nums flex-1">
              {formatYmdDash(d.dxdyYmd) || "—"}
              {d.dxdyHm ? ` ${formatHm(d.dxdyHm)}` : ""}
            </span>
            <DxdyResultBadge code={d.auctnDxdyRsltCd} />
            {d.dxdyPlcNm && (
              <span className="text-[11px] text-gray-500 truncate max-w-[40%]">
                {d.dxdyPlcNm}
              </span>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

/** 토지/건물/집합 구분 배지 — auctnLstDvsCd: 01=토지, 02=건물, 03=집합건물. */
function ObjectKindBadge({ code }: { code: string }) {
  let label = "기타";
  let cls = "bg-gray-100 text-gray-600";
  if (code === "01") {
    label = "🌿 토지";
    cls = "bg-emerald-50 text-emerald-700";
  } else if (code === "02") {
    label = "🏢 건물";
    cls = "bg-sky-50 text-sky-700";
  } else if (code === "03") {
    label = "🏬 집합건물";
    cls = "bg-indigo-50 text-indigo-700";
  } else if (!code) {
    return null;
  }
  return (
    <span
      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${cls}`}
    >
      {label}
    </span>
  );
}

function DxdyResultBadge({ code }: { code: string }) {
  // 001=진행 / 002=유찰 / 003=매각 (실측 패턴 기준)
  let label = code || "—";
  let cls = "bg-gray-100 text-gray-600";
  if (code === "002") {
    label = "유찰";
    cls = "bg-orange-50 text-orange-700";
  } else if (code === "003") {
    label = "매각";
    cls = "bg-amber-100 text-amber-800";
  } else if (code === "001") {
    label = "진행";
    cls = "bg-amber-50 text-amber-700";
  }
  return (
    <span
      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`}
    >
      {label}
    </span>
  );
}

// ─── 당사자 ───────────────────────────────────────────────

function PartiesSection({
  list,
}: {
  list: CourtRawDetailItem["dlt_rletCsIntrpsLst"];
}) {
  if (!list || list.length === 0) return null;
  return (
    <Section title={`👤 당사자 (${list.length}명)`}>
      <div className="space-y-1">
        {list.slice(0, 10).map((p, i) => (
          <div
            key={`${p.intrpsSeq}-${i}`}
            className="flex items-center gap-2 px-1"
          >
            <span className="text-[11px] text-gray-500 w-20 truncate flex-shrink-0">
              {p.auctnIntrpsDvsNm || "—"}
            </span>
            <span className="text-[12px] text-gray-800 truncate flex-1">
              {p.intrpsNm || "—"}
            </span>
          </div>
        ))}
        {list.length > 10 && (
          <div className="text-[11px] text-gray-400 text-center pt-0.5">
            ... 외 {list.length - 10}명
          </div>
        )}
      </div>
    </Section>
  );
}

// ─── 배당요구종기 ─────────────────────────────────────────

function DistributionSection({
  list,
}: {
  list: CourtRawDetailItem["dlt_dstrtDemnLstprdDts"];
}) {
  if (!list || list.length === 0) return null;
  // 보통 1건 — 첫 row 표시
  const d = list[0];
  return (
    <Section title="📑 배당요구종기">
      <div className="space-y-1">
        {d.dstrtDemnLstprdYmd && (
          <Row
            label="종기일"
            value={formatYmdDash(d.dstrtDemnLstprdYmd) || "—"}
            highlight
          />
        )}
        {d.dstrtDemnLstprdPbancYmd && (
          <Row
            label="공고일"
            value={formatYmdDash(d.dstrtDemnLstprdPbancYmd) || "—"}
            muted
          />
        )}
      </div>
    </Section>
  );
}

// ─── 관련 사건 ────────────────────────────────────────────

function RelatedCasesSection({
  list,
}: {
  list: NonNullable<CourtRawDetailItem["dlt_rletReltCsLst"]>;
}) {
  return (
    <Section title={`🔗 관련 사건 (${list.length}건)`}>
      <div className="space-y-1">
        {list.map((r, i) => (
          <div
            key={i}
            className="flex items-center gap-2 px-2 py-1.5 bg-white rounded border border-amber-100"
          >
            <span className="text-[12px] font-semibold text-gray-800 truncate flex-1">
              {r.userReltCsNo || "—"}
            </span>
            <span className="text-[11px] text-gray-500">
              {r.reltCsDvsNm || ""}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── 중복/병합/이송 ───────────────────────────────────────

function MergedCasesSection({
  list,
}: {
  list: NonNullable<CourtRawDetailItem["dlt_dpcnMrgTrnscsCsRlet"]>;
}) {
  return (
    <Section title={`🔀 중복/병합 (${list.length}건)`}>
      <div className="space-y-1">
        {list.map((r, i) => (
          <div
            key={i}
            className="px-2 py-1.5 bg-white rounded border border-amber-100"
          >
            <span className="text-[12px] font-semibold text-gray-800">
              {r.userReltCsNo || "—"}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── API 상태 배너 (court 전용 — hyphen ApiStatusBanner 미러) ──

function CourtApiStatusBanner({
  apiStatus,
  errMsg,
}: {
  apiStatus: CourtApiStatus;
  errMsg: string;
}) {
  if (apiStatus === "blocked") {
    return (
      <ApiStatusBanner
        apiStatus="unavailable"
        errCd=""
        errMsg={errMsg || "법원경매 사이트 일시 차단 — 잠시 후 재시도해 주세요"}
      />
    );
  }
  if (apiStatus === "unavailable") {
    return (
      <ApiStatusBanner
        apiStatus="unavailable"
        errCd=""
        errMsg={errMsg || "일시적 장애로 상세 조회 실패"}
      />
    );
  }
  return null;
}

// ─── 공통 컴포넌트 (hyphen AuctionDetailCard 미러) ────────

function Section({
  title,
  children,
}: {
  title: React.ReactNode;
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

function formatDday(days: number): string {
  if (days > 0) return `D-${days}`;
  if (days === 0) return "D-DAY";
  return `D+${Math.abs(days)}`;
}

function toPyeong(sqm: number): string {
  return Math.round(sqm * 0.3025).toLocaleString();
}

const NEXT_ROUND_RATIO = 0.7;

function estimateNextLowest(currentLowest: number): number {
  return Math.round((currentLowest * NEXT_ROUND_RATIO) / 10000) * 10000;
}

function pricePerPyeong(lowest: number, landSqm: number | null): number | null {
  if (!landSqm || landSqm <= 0) return null;
  const pyeong = landSqm * 0.3025;
  if (pyeong < 0.5) return null;
  return Math.round(lowest / pyeong / 10000);
}

/** "20260512" → "2026-05-12" */
function formatYmdDash(ymd: string | null | undefined): string | null {
  if (!ymd || ymd.length !== 8) return null;
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

/** "1000" → "10:00" */
function formatHm(hm: string | null | undefined): string | null {
  if (!hm || hm.length < 4) return null;
  return `${hm.slice(0, 2)}:${hm.slice(2, 4)}`;
}

/**
 * 담당계 전화 — court 응답엔 두 종류:
 *   - jdbnTelno: "530-1815(제4별관 민사집행과)" (담당계 직통, 부가설명 괄호)
 *   - execrCsTelno: "02-533-6852" (집행과 대표)
 * 둘 다 있으면 둘 다 표시. 빈값 0 표시.
 */
function composePhones(
  jdbn: string | null | undefined,
  execr: string | null | undefined,
): { tel: string; label: string }[] {
  const out: { tel: string; label: string }[] = [];
  if (jdbn) {
    const m = jdbn.match(/^([\d-]+)\s*\(?(.*?)\)?$/);
    const tel = m ? m[1].trim() : jdbn.trim();
    const desc = m && m[2] ? m[2].trim() : "";
    out.push({ tel, label: desc });
  }
  if (execr) {
    out.push({ tel: execr.trim(), label: "집행과" });
  }
  return out;
}
