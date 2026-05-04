"use client";

/**
 * 경매 매물 상세 탭 — ParcelInfoPanel 안에서 표시.
 *
 * 호출 방식 (캠코 OnbidTab 미러):
 *   - 사용자가 [경매] 탭 클릭 → useEffect 가 fetchAuctionByPnu(pnu) 호출.
 *   - /api/auction/by-pnu 내부에서 진행물건검색 면 sweep + PNU 매칭 + fallback.
 *   - 모듈 캐시 (lib/hyphen/by-pnu) 30분 TTL.
 *
 * 영업 시선 흐름 (위에서 아래):
 *   1. apiStatus 배너 (auth_failed = 결제 안내 / unavailable = 일시 장애)
 *   2. 매물 카드 — 사건명칭/진행상태/가격/D-day
 *   3. ⭐ 영업 핵심 OverviewCard — 감정가/최저가/할인율/매각기일/매각조건
 *   4. 📷 사진 갤러리 (lazy 상세 호출)
 *   5. 🏛 법원 정보 — 법원명/담당계/담당계전화 (전화 링크)
 *   6. 📐 면적 / 유찰 / 사건당사자
 *   7. 📋 권리분석 — 임차인현황/말소기준권리/등기부 (lazy)
 *   8. 💰 시뮬레이션 — 예상명도비/예상배당
 *   9. 📍 인근정보 — 인근물건/매각사례/역세권/개발계획 (lazy)
 */

import { useEffect, useState } from "react";

import {
  fetchAuctionByPnu,
  type AuctionByPnuFallback,
} from "@/lib/hyphen/by-pnu";
import type { AuctionListItem, HyphenApiStatus } from "@/lib/hyphen/types";

import ApiStatusBanner from "./ApiStatusBanner";
import AuctionItemCard from "./AuctionItemCard";
import AuctionDetailCard from "./AuctionDetailCard";
import CourtAuctionDetailCard from "./CourtAuctionDetailCard";

export default function AuctionTab({
  pnu,
  onPnuChange,
}: {
  pnu: string;
  /** fallback 카드 클릭 → 그 매물의 PNU 로 패널 자체를 갈아끼움 (캠코 OnbidTab 미러) */
  onPnuChange?: (pnu: string) => void;
}) {
  const [items, setItems] = useState<AuctionListItem[] | null>(null);
  const [fallback, setFallback] = useState<AuctionByPnuFallback>({
    used: false,
  });
  const [villageEmpty, setVillageEmpty] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [apiStatus, setApiStatus] = useState<HyphenApiStatus>("ok");
  const [errCd, setErrCd] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchAuctionByPnu(pnu)
      .then((res) => {
        if (!alive) return;
        setItems(res.items);
        setFallback(res.fallback);
        setVillageEmpty(res.villageEmpty);
        setTruncated(res.truncated);
        setApiStatus(res.apiStatus);
        setErrCd(res.errCd);
        setErrMsg(res.errMsg);
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
        <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <div className="text-xs text-gray-500">경매 매물 조회 중...</div>
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

  // ── 분기 0: API 상태 비정상 (인증 실패 / 결제 만료 / 일시 장애) ──
  // 매물 데이터 자체가 없으니 배너만 크게 표시.
  if (apiStatus !== "ok" && apiStatus !== "empty") {
    return (
      <div className="space-y-3">
        <ApiStatusBanner apiStatus={apiStatus} errCd={errCd} errMsg={errMsg} />
      </div>
    );
  }

  // ── 분기 1: 마을 전체에 경매 매물 0건 ──
  if (villageEmpty) {
    return (
      <div className="text-center py-10 text-xs text-gray-500 bg-gray-50 rounded border border-dashed border-gray-200 leading-relaxed">
        이 마을(면 단위)에 진행 중인 경매 매물이 없습니다
      </div>
    );
  }

  // ── 분기 2: 이 지번 매물 없음 + 같은 면 매물 있음 ──
  if (fallback.used) {
    return (
      <div className="space-y-2">
        <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-900 leading-relaxed">
          이 지번(<b>{fallback.target_jibun}</b>)은 경매 매물이 없어
          같은 마을(면)의 경매 매물{" "}
          <b>{fallback.villageItems.length}건</b>을 표시합니다
          {truncated && (
            <span className="text-amber-700">
              {" "}
              (200건 초과 — 일부만 표시)
            </span>
          )}
          .
        </div>
        <div className="space-y-2">
          {fallback.villageItems.map((it) => (
            <AuctionItemCard
              key={`${it.경매번호}-${it.물건번호}`}
              item={it}
              onClick={() => {
                // 다른 지번 클릭 시 패널을 그 PNU 로 갈아끼움 (캠코 OnbidTab 패턴)
                if (
                  onPnuChange &&
                  it.pnuStandard &&
                  /^\d{19}$/.test(it.pnuStandard)
                ) {
                  onPnuChange(it.pnuStandard);
                }
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  // ── 분기 3: 정상 매칭 ──
  if (!items || items.length === 0) {
    return (
      <div className="text-center py-10 text-xs text-gray-500 bg-gray-50 rounded border border-dashed border-gray-200">
        이 필지에 진행 중인 경매 매물이 없습니다
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <DetailCardSwitch
          key={`${item.경매번호}-${item.물건번호}`}
          item={item}
        />
      ))}
    </div>
  );
}

/**
 * 채널별 모달 분기 — item.courtCaseKey 박혀있으면 법원경매 전용,
 * 그 외(hyphen) 는 기존 풍부 모달 (사진/PDF/임차인 등 hyphen 강점 활용).
 *
 * env AUCTION_CHANNEL 에 의존하지 않고 데이터 자체로 판단 — 미래에 채널 혼합돼도
 * 자연스럽게 동작.
 */
function DetailCardSwitch({ item }: { item: AuctionListItem }) {
  if (item.courtCaseKey?.cortOfcCd && item.courtCaseKey?.csNo) {
    return <CourtAuctionDetailCard item={item} />;
  }
  return <AuctionDetailCard item={item} />;
}
