/**
 * /quote/[pnu] — 견적 모드 풀스크린 페이지.
 *
 * 1차 2단계 견적 발급 시스템의 진입 라우트. 1개 PNU 단위로 작동.
 * 위→아래 5섹션 (영역정의/시설견적/패널시각화/배치도PDF/수지분석) 으로 구성되며,
 * 이번 푸시는 1섹션(영역정의 — 건물 폴리곤 자동 표시)만 채우고 나머지는 placeholder.
 *
 * 책임 분리:
 *   - 이 서버 컴포넌트: 인증 + PNU 형식 검증 + 메타데이터
 *   - QuoteModeClient: 데이터 fetch + 지도 + 섹션별 UI
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import QuoteModeClient from "@/components/quote/QuoteModeClient";

export const metadata: Metadata = {
  title: "견적 모드",
};

interface PageProps {
  params: Promise<{ pnu: string }>;
}

export default async function QuotePage({ params }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { pnu } = await params;
  if (!/^\d{19}$/.test(pnu)) notFound();

  return <QuoteModeClient pnu={pnu} />;
}
