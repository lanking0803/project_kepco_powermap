/**
 * /admin/api-manager — 로컬 한정 API 관리 콘솔.
 *
 * 가드:
 *   1. NODE_ENV === "development"  (npm run dev)
 *   2. VERCEL !== "1"               (Vercel 어떤 모드에서도 차단)
 *   3. admin role                   (admin layout 이 강제)
 *
 * Vercel 배포본에서는 라우트 자체가 404. localhost 의 admin 만 접근 가능.
 *
 * 흐름:
 *   - manifest.generated.ts (scanner 산출물) 읽기
 *   - process.env 로 키 등록 상태 + 마스킹값 server-side 조립
 *   - URL searchParams (tab/id/method) 와 함께 ApiManagerClient 에 전달
 */
import { notFound } from "next/navigation";
import { MANIFEST } from "./_lib/manifest.generated";
import { collectServerKeys, toPublicMap } from "./_lib/server-keys";
import ApiManagerClient from "./_components/ApiManagerClient";
import type { HttpMethod } from "./_lib/types";

export const metadata = { title: "API 관리 — 관리자 (LOCAL ONLY)" };

interface PageProps {
  searchParams: Promise<{
    tab?: string;
    id?: string;
    method?: string;
  }>;
}

const VALID_METHODS: HttpMethod[] = ["GET", "POST", "PATCH", "PUT", "DELETE"];

export default async function ApiManagerPage({ searchParams }: PageProps) {
  if (process.env.NODE_ENV !== "development") notFound();
  if (process.env.VERCEL === "1") notFound();

  const params = await searchParams;
  const tab = params.tab === "internal" ? "internal" : "external";
  const id = params.id ?? null;
  const method =
    params.method && VALID_METHODS.includes(params.method as HttpMethod)
      ? (params.method as HttpMethod)
      : null;

  // 서버에서 .env.local 읽어 마스킹값 조립 → 클라이언트로는 raw 절대 X
  const serverKeys = collectServerKeys(MANIFEST.services);
  const keyMap = toPublicMap(serverKeys);

  return (
    <main className="max-w-7xl mx-auto px-6 py-6">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-lg font-bold text-gray-900">🔧 API 관리 콘솔</h2>
        <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-mono">
          LOCAL ONLY · NODE_ENV={process.env.NODE_ENV}
        </span>
        <div className="ml-auto text-[11px] text-gray-500">
          {MANIFEST.endpoints.length} endpoints · {MANIFEST.services.length} services · {MANIFEST.warnings.length} warnings
        </div>
      </div>

      <ApiManagerClient
        initialTab={tab}
        initialId={id}
        initialMethod={method}
        endpoints={MANIFEST.endpoints}
        services={MANIFEST.services}
        keyMap={keyMap}
        warnings={MANIFEST.warnings}
      />
    </main>
  );
}
