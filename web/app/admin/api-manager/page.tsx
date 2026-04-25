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
 * Step 1 현재 — scanner 동작 확인용 스켈레톤. UI 본체는 Step 5+ 에서 구현.
 */
import { notFound } from "next/navigation";
import { MANIFEST } from "./_lib/manifest.generated";

export const metadata = { title: "API 관리 — 관리자 (LOCAL ONLY)" };

export default function ApiManagerPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  if (process.env.VERCEL === "1") notFound();

  const endpointCount = MANIFEST.endpoints.length;
  const serviceCount = MANIFEST.services.length;
  const warningCount = MANIFEST.warnings.length;

  return (
    <main className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <h2 className="text-xl font-bold text-gray-900">🔧 API 관리 콘솔</h2>
        <span className="text-[11px] px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-mono">
          LOCAL ONLY · NODE_ENV={process.env.NODE_ENV}
        </span>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="text-sm text-gray-700 mb-4 font-semibold">
          📊 Scanner 수집 현황 (Step 1 검증용)
        </div>

        <div className="grid grid-cols-3 gap-6 mb-4">
          <div>
            <div className="text-xs text-gray-500 mb-1">내부 endpoint</div>
            <div className="text-2xl font-bold text-gray-900">
              {endpointCount}
              <span className="text-sm font-normal text-gray-500 ml-1">개</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">외부 서비스</div>
            <div className="text-2xl font-bold text-gray-900">
              {serviceCount}
              <span className="text-sm font-normal text-gray-500 ml-1">개</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Scanner 경고</div>
            <div
              className={`text-2xl font-bold ${
                warningCount > 0 ? "text-amber-600" : "text-gray-900"
              }`}
            >
              {warningCount}
              <span className="text-sm font-normal text-gray-500 ml-1">건</span>
            </div>
          </div>
        </div>

        {warningCount > 0 && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900">
            <div className="font-semibold mb-1">⚠ Scanner 경고 {warningCount}건</div>
            <ul className="list-disc pl-4 space-y-0.5">
              {MANIFEST.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <details className="mt-4 text-xs">
          <summary className="cursor-pointer text-gray-600 hover:text-gray-900">
            수집된 manifest 전체 펼쳐보기 (JSON)
          </summary>
          <pre className="mt-2 bg-gray-50 border border-gray-200 rounded p-3 overflow-auto max-h-96 text-[11px] leading-relaxed">
            {JSON.stringify(MANIFEST, null, 2)}
          </pre>
        </details>
      </div>

      <div className="mt-6 text-xs text-gray-500">
        Step 1 완료 — 다음: Step 5+ (탭/네비/디테일/라이브 테스터)
      </div>
    </main>
  );
}
