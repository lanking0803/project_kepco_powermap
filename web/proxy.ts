import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { isServiceExpired } from "@/lib/service-window";

/** 만료 안내 화면 경로 */
const SUSPENDED_PATH = "/suspended";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ⚠️ 이용기간 검사는 반드시 인증(updateSession)보다 먼저.
  //    Supabase 세션/쿠키를 건드리기 전에 차단해야 우회 여지가 없다.
  if (isServiceExpired()) {
    // API 요청은 안내 화면 대신 503 JSON
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "service_suspended", message: "이용 기간이 만료되었습니다." },
        { status: 503 }
      );
    }

    // 안내 화면 자체는 통과 (rewrite 무한루프 방지)
    if (pathname === SUSPENDED_PATH) {
      return NextResponse.next();
    }

    // 그 외 모든 경로 → URL 유지한 채 안내 화면으로 rewrite
    const url = request.nextUrl.clone();
    url.pathname = SUSPENDED_PATH;
    url.search = "";
    return NextResponse.rewrite(url, { status: 503 });
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * 다음 경로 외 모든 요청에 프록시 적용:
     * - _next/static (정적 자산)
     * - _next/image (이미지 최적화)
     * - favicon.ico
     * - 이미지/폰트 파일
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2)$).*)",
  ],
};
