"use client";

/**
 * 경매 API 상태 배너 — 의뢰자 결제 만료/오류 시 명확 안내.
 *
 * 의뢰자 의도 (2026-05-02):
 *   "API가 만료됐다 유효하지 않다 등등 상태값 체크해서 보여주는것도 필요하다.
 *    의뢰자가 직관적으로 'API결제를 안해서 안보이는거구나, 프로그램 오류가 아니구나'
 *    를 인지할수있게"
 *
 * apiStatus 매핑 (lib/hyphen/types.ts HYPHEN_ERR_CD_MAP):
 *   ok                   → 배너 없음 (정상)
 *   empty                → 배너 없음 (매물 0건은 정상 응답)
 *   auth_failed          → 🔴 결제 만료 의심 — Hyphen 마이페이지 가서 결제 확인
 *   insufficient_balance → 🔴 비즈머니 부족 — 충전 필요
 *   rate_limited         → 🟡 일시적 속도 제한 (운영 모드선 거의 없음)
 *   unavailable          → 🟡 일시 장애 — 잠시 후 재시도
 */

import type { HyphenApiStatus } from "@/lib/hyphen/types";

const HYPHEN_BIZMONEY_URL = "https://hyphen.im/mypage/my-bizmoney";

interface Props {
  apiStatus: HyphenApiStatus;
  errCd?: string;
  errMsg?: string;
}

export default function ApiStatusBanner({ apiStatus, errCd, errMsg }: Props) {
  if (apiStatus === "ok" || apiStatus === "empty") return null;

  const config = STATUS_CONFIG[apiStatus];

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 p-3 rounded-lg border ${config.containerClass}`}
    >
      <div className="text-xl flex-shrink-0 leading-none mt-0.5">
        {config.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-bold ${config.titleClass}`}>
          {config.title}
        </div>
        <p className="text-xs text-gray-700 mt-1 leading-relaxed whitespace-pre-line">
          {config.message}
        </p>
        {errCd && (
          <p className="text-[10px] text-gray-400 mt-1 font-mono">
            errCd: {errCd}
            {errMsg ? ` · ${errMsg}` : ""}
          </p>
        )}
        {config.actionUrl && (
          <a
            href={config.actionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1 mt-2 text-xs font-semibold ${config.linkClass}`}
          >
            {config.actionLabel}
            <span>↗</span>
          </a>
        )}
      </div>
    </div>
  );
}

const STATUS_CONFIG: Record<
  Exclude<HyphenApiStatus, "ok" | "empty">,
  {
    icon: string;
    title: string;
    message: string;
    containerClass: string;
    titleClass: string;
    linkClass: string;
    actionUrl?: string;
    actionLabel?: string;
  }
> = {
  auth_failed: {
    icon: "🔴",
    title: "경매 API 인증 실패 — 결제 만료 가능성",
    message:
      "Hyphen 경매 API 가 응답을 거부하고 있습니다. 비즈머니 잔액이 떨어졌거나 결제가 만료됐을 수 있습니다.\n프로그램 오류가 아닌, 결제 갱신이 필요한 상황입니다.",
    containerClass: "bg-red-50 border-red-200",
    titleClass: "text-red-700",
    linkClass: "text-red-700 hover:text-red-900",
    actionUrl: HYPHEN_BIZMONEY_URL,
    actionLabel: "Hyphen 마이페이지 — 비즈머니 충전",
  },
  no_permission: {
    icon: "🔴",
    title: "경매 API 사용권한 없음 — Hyphen 측 신청 필요",
    message:
      "유료 결제는 됐지만 운영 모드 사용권이 부여되지 않은 상태입니다.\nHyphen 마이페이지에서 운영 모드 사용 신청 또는 고객센터(1600-4173) 문의가 필요합니다.",
    containerClass: "bg-red-50 border-red-200",
    titleClass: "text-red-700",
    linkClass: "text-red-700 hover:text-red-900",
    actionUrl: HYPHEN_BIZMONEY_URL,
    actionLabel: "Hyphen 마이페이지에서 권한 확인",
  },
  insufficient_balance: {
    icon: "🔴",
    title: "비즈머니 부족 — 충전 필요",
    message:
      "Hyphen 비즈머니 잔액이 부족하여 매물 정보를 받아올 수 없습니다.\n충전 후 자동으로 정상화됩니다.",
    containerClass: "bg-red-50 border-red-200",
    titleClass: "text-red-700",
    linkClass: "text-red-700 hover:text-red-900",
    actionUrl: HYPHEN_BIZMONEY_URL,
    actionLabel: "Hyphen 마이페이지 — 비즈머니 충전",
  },
  rate_limited: {
    icon: "🟡",
    title: "잠시 후 다시 시도해주세요",
    message:
      "경매 API 호출이 일시적으로 제한되었습니다. 20초 정도 후 자동으로 정상화됩니다.",
    containerClass: "bg-yellow-50 border-yellow-200",
    titleClass: "text-yellow-800",
    linkClass: "text-yellow-700 hover:text-yellow-900",
  },
  unavailable: {
    icon: "🟡",
    title: "경매 API 일시 장애",
    message:
      "경매 정보 서버와 통신이 일시적으로 원활하지 않습니다. 다른 탭은 정상 동작하니 잠시 후 다시 시도해주세요.",
    containerClass: "bg-yellow-50 border-yellow-200",
    titleClass: "text-yellow-800",
    linkClass: "text-yellow-700 hover:text-yellow-900",
  },
};
