"use client";

/**
 * 외부 서비스 디테일 패널.
 *
 * 표시:
 *   - 이름 / 콘솔 링크 / 카테고리
 *   - envKeys (등록상태 + 마스킹) — Step 5 에서 토글로 전체 노출
 *   - 만료일 (D-day 배지) / 일일 한도
 *   - 발급 방법 / 사용 예시 / 특이사항
 *   - consumedBy: 이 서비스 쓰는 endpoint 목록 → 클릭 시 내부 탭으로 점프
 *   - 📝 VSCode 점프 (Step 5)
 */

import { useRouter, useSearchParams } from "next/navigation";
import type { CollectedExternalService } from "../_lib/types";
import type { KeyStatusPublic } from "../_lib/server-keys";
import ExpiryBadge from "./ExpiryBadge";

interface Props {
  service: CollectedExternalService;
  envKeys: KeyStatusPublic[];
}

const CATEGORY_LABEL: Record<string, string> = {
  geocoding: "지오코딩",
  "data.go.kr": "data.go.kr 산하",
  infra: "인프라",
  scraping: "스크래핑 (비공식)",
};

export default function ServicePanel({ service, envKeys }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function jumpToEndpoint(endpointId: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("tab", "internal");
    sp.set("id", endpointId);
    sp.delete("method");
    router.replace(`?${sp.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h3 className="text-lg font-bold text-gray-900">{service.name}</h3>
          <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-mono">
            {service.id}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">
            {CATEGORY_LABEL[service.category] ?? service.category}
          </span>
        </div>
        <a
          href={service.consoleUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-600 hover:text-blue-800 underline break-all"
        >
          콘솔 ↗ {service.consoleUrl}
        </a>
      </div>

      {/* 핵심 정보 카드 */}
      <div className="grid grid-cols-2 gap-3">
        <InfoCell label="만료일">
          <ExpiryBadge expiry={service.expiry} />
        </InfoCell>
        <InfoCell label="일일 한도">
          <span className="text-xs text-gray-700">{service.dailyLimit ?? "—"}</span>
        </InfoCell>
      </div>

      {/* 환경변수 키 */}
      <Section title="🔑 환경변수">
        {envKeys.length === 0 ? (
          <div className="text-xs text-gray-400">등록된 환경변수 없음</div>
        ) : (
          <div className="space-y-1.5">
            {envKeys.map((k) => (
              <div
                key={k.name}
                className="flex items-center gap-2 text-xs font-mono"
              >
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full ${
                    k.present ? "bg-green-500" : "bg-red-400"
                  }`}
                  title={k.present ? "등록됨" : "미등록"}
                />
                <span className="text-gray-700">{k.name}</span>
                <span className="text-gray-400">
                  {k.present ? `${k.masked} (${k.length}자)` : "❌ .env.local 에 미등록"}
                </span>
              </div>
            ))}
            <div className="text-[10px] text-gray-400 pt-1">
              ※ Step 5 에서 [👁 전체 표시] 토글 + 클립보드 복사 추가 예정
            </div>
          </div>
        )}
      </Section>

      {/* consumedBy */}
      <Section title={`🔗 이 서비스를 호출하는 내부 endpoint (${service.consumedBy.length})`}>
        {service.consumedBy.length === 0 ? (
          <div className="text-xs text-gray-400">
            현재 직접 호출하는 endpoint 없음 (클라이언트 SDK 또는 미구현)
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {service.consumedBy.map((id) => (
              <button
                key={id}
                onClick={() => jumpToEndpoint(id)}
                className="text-xs font-mono px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded border border-blue-200 transition-colors"
                title="내부 API 탭으로 이동"
              >
                /{id} →
              </button>
            ))}
          </div>
        )}
      </Section>

      {/* 발급 방법 */}
      <Section title="📖 발급 방법">
        <PreText>{service.issueGuide}</PreText>
      </Section>

      {/* 사용 예시 */}
      {service.usageExample && (
        <Section title="💡 사용 예시">
          <pre className="text-[11px] bg-gray-900 text-gray-100 p-3 rounded overflow-x-auto leading-relaxed">
            {service.usageExample}
          </pre>
        </Section>
      )}

      {/* 특이사항 */}
      {service.notes && (
        <Section title="📌 특이사항 / 메모">
          <PreText>{service.notes}</PreText>
        </Section>
      )}

      {/* 파일 위치 — Step 5 에서 VSCode 점프 버튼으로 */}
      <Section title="📂 메타 파일">
        <div className="text-xs font-mono text-gray-500 break-all">
          web/{service.filePath}:{service.metaLine}
        </div>
        <div className="text-[10px] text-gray-400 mt-0.5">
          ※ Step 5 에서 [📝 VSCode 에서 편집] 버튼 추가 예정
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold text-gray-700 mb-1.5">{title}</div>
      {children}
    </div>
  );
}

function InfoCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded p-2.5">
      <div className="text-[10px] text-gray-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

function PreText({ children }: { children: string }) {
  return (
    <pre className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed font-sans">
      {children}
    </pre>
  );
}
