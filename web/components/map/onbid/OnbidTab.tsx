"use client";

/**
 * 공매 매물 상세 탭 — ParcelInfoPanel 안에서 표시.
 *
 * 호출 방식:
 *   - 사용자가 [공매] 탭 클릭 → useEffect 가 fetchOnbidByPnu(pnu) 호출.
 *   - /api/onbid/by-pnu 내부에서 캠코 목록 + 상세 병렬 호출.
 *   - 모듈 캐시 있으면 즉시 표시 (탭 재방문 비용 0).
 *
 * 영업 시선 흐름 (위에서 아래):
 *   1. 헤더 — 카테고리/매물명/주소
 *   2. ⭐ Hero 한 줄 — "유찰 N회 · X% 할인 · D-N · 최저 NN만원" (카톡 복붙용)
 *   3. 💰 가격 비교 카드 — 감정가 → 최저입찰가 + 큰 할인율 배지 + D-day + 입찰종료일시
 *   4. 📷 사진 (라이트박스 풀스크린)
 *   5. 360/영상 멀티미디어
 *   6. 면적 / 위치 / 활용 / 입찰조건 / 매수자격 / 납부사항 / 인도책임 / 기타
 *   7. 📊 감정평가 이력 (PDF)
 *   8. 📎 부가정보 (재산유형/물건관리번호)
 *   9. 외부 액션 — 캠코 사이트로 + 매물명 복사
 */

import { useEffect, useState, useCallback } from "react";
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
// 매물 1건 상세 카드 — 영업 시선 흐름 재구성
// ───────────────────────────────────────────

function DetailCard({ item }: { item: OnbidDetail }) {
  const discountPct = Math.round(item.discountRatio * 100);
  const isMarketed = item.daysLeft >= 0; // 진행 중

  return (
    <div className="border border-rose-200 rounded-lg overflow-hidden bg-white">
      {/* ── 1. 헤더 — 카테고리/매물명/주소 ── */}
      <div className="px-3 py-2.5 bg-rose-50 border-b border-rose-100">
        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
          {item.ourCategory && (
            <span className="text-[10px] font-semibold text-rose-700 bg-white px-1.5 py-0.5 rounded border border-rose-200">
              {OUR_CATEGORY_LABEL[item.ourCategory]}
            </span>
          )}
          <span className="text-[10px] text-gray-600">
            {item.cltrUsgSclsCtgrNm}
          </span>
          <span className="text-[10px] text-gray-400">·</span>
          <span className="text-[10px] text-gray-500">{item.prptDivNm}</span>
        </div>
        <div className="text-sm font-bold text-gray-900 leading-tight">
          {item.onbidCltrNm}
        </div>
        {item.cltrRadr && (
          <div className="text-[11px] text-gray-500 mt-1">
            🏠 {item.cltrRadr}
          </div>
        )}
      </div>

      <div className="p-3 space-y-3">
        {/* ── 2. 영업 핵심 카드 — 회차/가격/시간/시나리오 통합 ──
            영업 시선 흐름: 회차 → 가격 → 할인 → 시간 → (구분) → 회차 시나리오. */}
        <DealOverviewCard item={item} discountPct={discountPct} />

        {/* ── 4. 사진 갤러리 (라이트박스 풀스크린) ── */}
        {item.photoUrls.length > 0 && (
          <PhotoGallery
            photos={item.photoUrls}
            thumbs={item.photoThumbUrls}
          />
        )}

        {/* ── 5. 360 / 영상 ── */}
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

        {/* ── 6. 면적 ── */}
        {((item.landSqms ?? 0) > 0 ||
          (item.bldSqms ?? 0) > 0 ||
          item.usbdNft != null) && (
          <Section title="📐 면적 / 유찰">
            <div className="text-xs text-gray-700 space-y-1">
              {item.landSqms != null && item.landSqms > 0 && (
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
              {item.usbdNft != null && item.usbdNft > 0 && (
                <Row
                  label="유찰"
                  value={`${item.usbdNft}회`}
                  highlight
                />
              )}
              {item.frstPbancYmd && (
                <Row label="최초공고" value={formatYmd(item.frstPbancYmd)} muted />
              )}
            </div>
          </Section>
        )}

        {/* ── 7. 위치/접근성 ── */}
        {item.locVntyPscdCont && (
          <Section title="📍 위치 / 접근성">
            <CollapsibleText text={item.locVntyPscdCont} />
          </Section>
        )}

        {/* ── 8. 활용/이용 ── */}
        {item.utlzPscdCont && (
          <Section title="🌳 활용 / 이용 현황">
            <CollapsibleText text={item.utlzPscdCont} />
          </Section>
        )}

        {/* ── 9. 입찰조건 ── */}
        {item.icdlCdtnCont && (
          <Section title="📋 입찰조건">
            <CollapsibleText text={item.icdlCdtnCont} />
          </Section>
        )}

        {/* ── 10. 매수자격 ── */}
        {item.purrQlfcCont && (
          <Section title="👤 매수자격">
            <CollapsibleText text={item.purrQlfcCont} />
          </Section>
        )}

        {/* ── 11. 납부사항 ── */}
        {item.pytnMtrsCont && (
          <Section title="💳 납부사항 / 유의사항">
            <CollapsibleText text={item.pytnMtrsCont} />
          </Section>
        )}

        {/* ── 12. 인도/인수 책임 ── */}
        {item.evcRsbyTrgtCont && (
          <Section title="🤝 인도/인수 책임">
            <div className="text-xs text-gray-700">{item.evcRsbyTrgtCont}</div>
          </Section>
        )}

        {/* ── 13. 기타사항 ── */}
        {item.cltrEtcCont && (
          <Section title="ℹ️ 기타사항">
            <CollapsibleText text={item.cltrEtcCont} />
          </Section>
        )}

        {/* ── 14. 감정평가 이력 ── */}
        {item.appraisals.length > 0 && (
          <Section title="📊 감정평가 이력">
            <div className="space-y-1.5">
              {item.appraisals.map((a, i) => (
                <AppraisalRow key={i} appraisal={a} />
              ))}
            </div>
          </Section>
        )}

        {/* ── 15. 부가정보 ── */}
        <Section title="📎 부가 정보">
          <div className="text-xs text-gray-700 space-y-1">
            <Row label="물건관리번호" value={item.cltrMngNo} mono />
            <Row label="온비드물건번호" value={String(item.onbidCltrno)} mono />
          </div>
        </Section>

        {/* ── 16. 외부 액션 — 캠코 사이트 + 매물명 복사 ── */}
        {isMarketed && <ExternalActions item={item} />}
      </div>
    </div>
  );
}

// ─── 영업 핵심 통합 카드 ────────────────
//   영업 시선 흐름 한 카드 안에 (중복 제거):
//     [헤더]  진행 회차 (5/6차)                           ⚠️ D-12 마감
//     [메인]                4,608만원
//                          80% ↓ (감정가 2.30억)
//     [입찰] 입찰: 2026-05-11 ~ 05-13 17:00
//     ─── 점선 구분 ───
//     [시나리오] 5차 → 6차까지 단계적 진행 · 회차당 약 18% 인하
//                모든 회차 유찰 시 → 2,304만원 (90%↓)
//
//   회차 정보가 없는 매물(roundTotal=1) 은 시나리오 영역만 자동 숨김.

function DealOverviewCard({
  item,
  discountPct,
}: {
  item: OnbidDetail;
  discountPct: number;
}) {
  const isClosed = item.daysLeft < 0;
  const hasRounds = item.roundTotal > 1;
  const isLastRound = hasRounds && item.roundCurrent >= item.roundTotal;
  const minMan =
    item.minRoundPrice != null ? Math.round(item.minRoundPrice / 10000) : null;
  const minDiscountPct =
    item.minRoundDiscountRatio != null
      ? Math.round(item.minRoundDiscountRatio * 100)
      : null;
  // 회차당 인하율 = 마지막 회차 할인율 / (총 회차 - 1).
  // 캠코 실측 (양덕리/곡천리/연호리) 모두 균등 인하 확인.
  const stepDiscountPct =
    minDiscountPct != null && item.roundTotal > 1
      ? Math.round(minDiscountPct / (item.roundTotal - 1))
      : null;

  return (
    <div className="rounded-lg border border-rose-300 bg-white overflow-hidden">
      {/* ── 헤더: 회차 위치 + D-day ── */}
      <div
        className={`flex items-center justify-between gap-2 px-3 py-2 border-b ${
          isClosed
            ? "bg-gray-100 border-gray-200"
            : item.isUrgent
              ? "bg-rose-600 border-rose-700"
              : "bg-rose-50 border-rose-100"
        }`}
      >
        <span
          className={`text-xs font-bold ${
            isClosed
              ? "text-gray-500"
              : item.isUrgent
                ? "text-white"
                : "text-rose-800"
          }`}
        >
          {hasRounds ? (
            <>
              {isLastRound && "⚠️ "}
              {item.roundCurrent}/{item.roundTotal}차{" "}
              {isLastRound ? "마지막 회차" : "진행 중"}
            </>
          ) : (
            "공매 진행 중"
          )}
        </span>
        <span
          className={`text-xs font-bold tabular-nums ${
            isClosed
              ? "text-gray-500 line-through"
              : item.isUrgent
                ? "text-white"
                : "text-rose-700"
          }`}
        >
          {isClosed ? "마감" : `D-${item.daysLeft} 마감`}
        </span>
      </div>

      {/* ── 메인 가격 + 할인율 + 감정가 ── */}
      <div className="px-3 py-3 text-center space-y-1">
        <div className="text-[10px] font-semibold text-gray-500">
          최저입찰가
        </div>
        <div className="text-2xl font-bold text-rose-700 tabular-nums leading-none">
          {formatPrice(item.lowstBidPrc)}
        </div>
        {discountPct > 0 && (
          <div className="text-[11px] text-gray-600">
            <span className="px-1.5 py-px bg-rose-600 text-white text-[11px] font-bold rounded mr-1.5">
              {discountPct}%↓
            </span>
            <span className="text-gray-400">감정가</span>{" "}
            <span className="text-gray-500 line-through tabular-nums">
              {formatPrice(item.apslEvlAmt)}
            </span>
          </div>
        )}
      </div>

      {/* ── 입찰 기간 ── */}
      <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 text-[11px] text-gray-700 tabular-nums text-center">
        입찰 기간 · {formatBidDate(item.cltrBidBgngDt)} ~{" "}
        {formatBidDate(item.cltrBidEndDt).slice(5)}
      </div>

      {/* ── 회차 시나리오 (회차 ≥ 2 일 때만) ── */}
      {hasRounds && (
        <div className="px-3 py-2.5 border-t-2 border-dashed border-gray-200 bg-amber-50/40 space-y-1.5">
          <div className="text-[11px] font-bold text-amber-900">
            📉 회차 시나리오
          </div>
          {isLastRound ? (
            <div className="text-[12px] text-rose-700 leading-snug">
              이번이 마지막 입찰 기회입니다. 유찰 시 매물 종료.
            </div>
          ) : (
            minMan != null &&
            minDiscountPct != null && (
              <>
                <div className="text-[12px] text-gray-700 leading-snug">
                  <b>{item.roundCurrent}차(현재)</b> →{" "}
                  <b>{item.roundTotal}차</b>까지 단계적 진행
                  {stepDiscountPct != null && stepDiscountPct > 0 && (
                    <span className="text-gray-500">
                      {" · "}회차당 약 {stepDiscountPct}% 인하
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-gray-600">모든 회차 유찰 시</span>
                  <span className="tabular-nums">
                    <span className="font-semibold text-rose-700">
                      {minMan.toLocaleString()}만원
                    </span>
                    <span className="text-emerald-600 font-semibold ml-1">
                      ({minDiscountPct}%↓)
                    </span>
                  </span>
                </div>
              </>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ─── 외부 액션 — 캠코 검색 한 번에 ─────────────
//   캠코 사이트는 매물 상세 직링 불가 (URL 패턴 미공개 + 로그인 강제 + POST 폼).
//   → "원클릭" UX 로 통합:
//      1) 클립보드에 매물명+번호 자동 복사
//      2) 새 탭에 캠코 메인 열기
//      3) 인라인 안내 (toast 대신 항상 보이는 가이드 — 영업이 처음 보는 화면이므로)

function ExternalActions({ item }: { item: OnbidDetail }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const handleClick = useCallback(async () => {
    // a 태그 default 동작(새 탭 열기) 은 그대로 — 클립보드만 사이드이펙트.
    //
    // 복사 텍스트 = 물건관리번호만.
    //   캠코 매물명은 "대구광역시 수성구 시지동 574-4 (토지), 시지동 574-4 에덴스마트시티(건물)"
    //   처럼 길고 분류 텍스트 섞여 검색이 안 됨 (실측). 물건관리번호는 캠코 정식 식별자라
    //   검색창에 그대로 붙여넣으면 100% 매칭.
    try {
      await navigator.clipboard.writeText(item.cltrMngNo);
      setState("copied");
    } catch {
      // 클립보드 권한 거부 시 — 새 탭은 그대로 열리되 사용자에게 알림
      setState("failed");
    }
    setTimeout(() => setState("idle"), 3000);
    // e.preventDefault() 안 함 → 새 탭 열기 그대로 진행
  }, [item.cltrMngNo]);

  return (
    <div className="space-y-2 pt-1">
      <a
        href="https://www.onbid.co.kr/"
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        className="block py-3 text-sm font-bold text-center
                   bg-rose-600 hover:bg-rose-700 active:bg-rose-800
                   text-white rounded-md shadow-sm transition-colors"
        title={`온비드물건번호: ${item.onbidCltrno}`}
      >
        🔗 캠코 온비드에서 검색하기 ↗
      </a>

      {/* 동작 결과 — 클릭 후 3초 노출 */}
      {state === "copied" && (
        <div className="px-2 py-1.5 bg-emerald-50 border border-emerald-200 rounded text-[11px] text-emerald-800 leading-snug">
          ✅ 매물번호 <b className="font-mono">{item.cltrMngNo}</b> 복사됨.
          캠코 검색창에 <b>붙여넣기 (Ctrl+V)</b> 하세요.
        </div>
      )}
      {state === "failed" && (
        <div className="px-2 py-1.5 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-800 leading-snug">
          ⚠️ 자동 복사 실패. 아래 매물번호를 직접 복사해 주세요.
        </div>
      )}

      {/* 영구 안내 — 캠코 직링 불가 사유 + 사용 흐름 */}
      <div className="px-2 py-1.5 bg-gray-50 border border-gray-200 rounded text-[11px] text-gray-600 leading-relaxed">
        <div className="font-semibold text-gray-700 mb-0.5">
          ℹ️ 캠코는 매물 직링이 막혀있습니다
        </div>
        버튼 클릭 시 <b>매물번호가 자동 복사</b>되고 캠코 사이트가 새 탭으로 열립니다.
        캠코 검색창에 붙여넣기 하면 해당 매물을 찾을 수 있습니다.
        <div className="mt-1 text-[10px] text-gray-500 font-mono select-all">
          매물번호: {item.cltrMngNo}
        </div>
      </div>
    </div>
  );
}

// ─── 사진 갤러리 — 메인 + 썸네일 + 라이트박스 ─
//   메인 사진 클릭 → 풀스크린 라이트박스 (작은 화면에서 영업 판단 어려움 해결)

function PhotoGallery({
  photos,
  thumbs,
}: {
  photos: string[];
  thumbs: string[];
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  // 썸네일 fallback: 원본 URL 그대로 (응답에 thumbs 누락 시).
  const thumbAt = (i: number) => thumbs[i] ?? photos[i];

  return (
    <div>
      <div className="text-[10px] md:text-[11px] font-bold text-gray-500 mb-1.5 tracking-wider uppercase">
        📷 사진 ({photos.length})
      </div>
      {/* 큰 사진 — 클릭 시 라이트박스 */}
      <div className="aspect-video bg-gray-100 rounded-md overflow-hidden mb-1.5 relative group">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photos[activeIdx]}
          alt={`매물 사진 ${activeIdx + 1}`}
          className="w-full h-full object-contain cursor-zoom-in"
          loading="lazy"
          onClick={() => setLightbox(true)}
        />
        {photos.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveIdx((i) => (i - 1 + photos.length) % photos.length);
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
                setActiveIdx((i) => (i + 1) % photos.length);
              }}
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
        <span className="absolute left-2 bottom-2 px-2 py-0.5 bg-black/60 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity">
          🔍 클릭으로 확대
        </span>
      </div>
      {/* 썸네일 가로 스크롤 — 작은 칸은 7KB 썸네일로 페이지 부담 줄임 */}
      {photos.length > 1 && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {photos.map((_, i) => (
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
                src={thumbAt(i)}
                alt={`썸네일 ${i + 1}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      {/* 라이트박스 — 닫힐 때 마지막 본 사진 인덱스 갤러리에 동기화 */}
      {lightbox && (
        <PhotoLightbox
          photos={photos}
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

// ─── 라이트박스 — 풀스크린 사진 뷰어 ─────────
//   ESC / 배경 클릭 / X 버튼으로 닫음. ◀▶ 키보드/클릭 네비.

function PhotoLightbox({
  photos,
  startIdx,
  onClose,
}: {
  photos: string[];
  startIdx: number;
  onClose: (lastIdx: number) => void;
}) {
  const [idx, setIdx] = useState(startIdx);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose(idx);
      } else if (e.key === "ArrowLeft") {
        setIdx((i) => (i - 1 + photos.length) % photos.length);
      } else if (e.key === "ArrowRight") {
        setIdx((i) => (i + 1) % photos.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photos.length, onClose, idx]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={() => onClose(idx)}
    >
      {/* 이미지 영역 — 닫기/네비 버튼 영역(상하단 padding) 침범하지 않도록 inset 으로 확보.
          작은 사진도 사용 가능한 영역까지 채우도록 w-full h-full + object-contain. */}
      <div
        className="absolute inset-x-4 top-20 bottom-20 flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photos[idx]}
          alt={`매물 사진 ${idx + 1}`}
          className="w-full h-full object-contain"
        />
      </div>
      {photos.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIdx((i) => (i - 1 + photos.length) % photos.length);
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
              setIdx((i) => (i + 1) % photos.length);
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-black/50 hover:bg-black/70 text-white rounded-full text-xl z-10 flex items-center justify-center"
            aria-label="다음 사진"
          >
            ▶
          </button>
          <span className="absolute bottom-6 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/60 text-white text-sm rounded z-10">
            {idx + 1} / {photos.length}
          </span>
        </>
      )}
      {/* 닫기 — z-10 으로 항상 이미지/네비보다 위 */}
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

// ─── 텍스트 자동 접기 (3줄 이상이면 더보기) ───
//   본문 텍스트가 길어지면 영업이 핵심만 빠르게 훑게 도움.

function CollapsibleText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  // 줄바꿈 4개 이상 또는 200자 이상이면 접기 활성
  const lineCount = text.split(/\r?\n/).length;
  const needsCollapse = lineCount >= 4 || text.length >= 200;

  if (!needsCollapse) {
    return (
      <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-line">
        {text}
      </div>
    );
  }

  return (
    <div>
      <div
        className={`text-xs text-gray-700 leading-relaxed whitespace-pre-line ${
          !expanded ? "line-clamp-3" : ""
        }`}
      >
        {text}
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-[11px] text-rose-600 hover:text-rose-800 font-semibold mt-1"
      >
        {expanded ? "▲ 접기" : "▼ 더보기"}
      </button>
    </div>
  );
}

// ─── 보조 컴포넌트 ────────────────────────

/**
 * 섹션 — 헤더 바(rose-50) + 본문(흰 배경) 카드.
 * 영업이 빠른 훑기로 섹션 위치를 즉시 파악할 수 있도록 시각적 구분 강화.
 */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-rose-100 overflow-hidden">
      <div className="px-2.5 py-1.5 bg-rose-50 border-b border-rose-100">
        <div className="text-xs font-bold text-rose-900">{title}</div>
      </div>
      <div className="px-2.5 py-2 bg-white">{children}</div>
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
