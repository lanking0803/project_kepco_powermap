"use client";

/**
 * 내부 endpoint 디테일 패널.
 *
 * 표시:
 *   - path · method 탭 (multi-method 시)
 *   - source / cache / auth
 *   - 입력 파라미터 표 (sample 값 포함)
 *   - 응답 스키마
 *   - externalDeps → 외부 탭으로 점프
 *   - dangerous 경고 + dangerNote
 *   - notes
 *   - 라이브 테스터 (Step 4) — 입력 폼 / 호출 / 응답 표시
 *   - 파일 위치 (Step 5 에서 VSCode 점프)
 *
 * meta 미정의 endpoint 도 동작 (path/method 만 표시 + ⚠ 배지). 라이브 테스터는
 * meta 가 있는 경우에만 노출.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import type { CollectedEndpoint, HttpMethod } from "../_lib/types";
import LiveTester from "./LiveTester";

interface Props {
  endpoint: CollectedEndpoint;
  selectedMethod: HttpMethod | null;
}

const AUTH_LABEL: Record<string, { text: string; color: string }> = {
  none: { text: "인증 불필요", color: "bg-gray-100 text-gray-600" },
  user: { text: "사용자 (getCurrentUser)", color: "bg-blue-50 text-blue-700" },
  admin: { text: "관리자 (requireAdmin)", color: "bg-purple-50 text-purple-700" },
  system: { text: "시스템 (Bearer CRON_SECRET)", color: "bg-amber-50 text-amber-700" },
};

const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: "bg-green-100 text-green-700",
  POST: "bg-blue-100 text-blue-700",
  PATCH: "bg-amber-100 text-amber-700",
  PUT: "bg-amber-100 text-amber-700",
  DELETE: "bg-red-100 text-red-700",
};

export default function EndpointPanel({ endpoint, selectedMethod }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeMethod = useMemo(() => {
    if (selectedMethod) {
      const m = endpoint.methods.find((x) => x.method === selectedMethod);
      if (m) return m;
    }
    return endpoint.methods[0];
  }, [endpoint, selectedMethod]);

  function selectMethod(method: HttpMethod) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("method", method);
    router.replace(`?${sp.toString()}`, { scroll: false });
  }

  function jumpToService(serviceId: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("tab", "external");
    sp.set("id", serviceId);
    sp.delete("method");
    router.replace(`?${sp.toString()}`, { scroll: false });
  }

  if (!activeMethod) return null;
  const meta = activeMethod.meta;

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded ${METHOD_COLOR[activeMethod.method]}`}
          >
            {activeMethod.method}
          </span>
          <h3 className="text-lg font-bold font-mono text-gray-900">
            {endpoint.path}
          </h3>
        </div>
        <div className="text-[11px] text-gray-500 font-mono">id: {endpoint.id}</div>
      </div>

      {/* 메서드 탭 (multi-method 시) */}
      {endpoint.methods.length > 1 && (
        <div className="flex gap-1 border-b border-gray-200">
          {endpoint.methods.map((m) => (
            <button
              key={m.method}
              onClick={() => selectMethod(m.method)}
              className={`text-xs px-3 py-1.5 border-b-2 font-mono transition-colors ${
                m.method === activeMethod.method
                  ? "border-blue-500 text-blue-600 font-semibold"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {m.method}
              {!m.meta && <span className="ml-1 text-amber-500">⚠</span>}
            </button>
          ))}
        </div>
      )}

      {/* meta 미정의 안내 */}
      {!meta && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900">
          ⚠ <code>meta{endpoint.methods.length > 1 ? activeMethod.method : ""}</code> 가 정의되지 않은 endpoint 입니다.
          <br />
          <span className="text-[11px] text-amber-700">
            web/{endpoint.filePath} 에 <code>export const meta{endpoint.methods.length > 1 ? activeMethod.method : ""}</code> 추가하세요.
          </span>
        </div>
      )}

      {/* 핵심 정보 */}
      {meta && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <InfoCell label="데이터 출처">
              <span className="text-xs text-gray-700">{meta.source}</span>
            </InfoCell>
            <InfoCell label="캐시 정책">
              <code className="text-xs text-gray-700 break-all">{meta.cache}</code>
            </InfoCell>
            <InfoCell label="인증">
              <span
                className={`inline-block text-[11px] px-1.5 py-0.5 rounded ${
                  AUTH_LABEL[meta.auth]?.color ?? "bg-gray-100 text-gray-600"
                }`}
              >
                {AUTH_LABEL[meta.auth]?.text ?? meta.auth}
              </span>
            </InfoCell>
            <InfoCell label="외부 의존">
              {meta.externalDeps && meta.externalDeps.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {meta.externalDeps.map((dep) => (
                    <button
                      key={dep}
                      onClick={() => jumpToService(dep)}
                      className="text-[11px] font-mono px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded border border-blue-200"
                    >
                      {dep} →
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-gray-400">없음 (DB 또는 내부 로직만)</span>
              )}
            </InfoCell>
          </div>

          {/* 위험 작업 안내 (메타 차원) — confirm 은 LiveTester 가 처리 */}
          {meta.dangerous && (
            <div className="p-3 bg-red-50 border-2 border-red-300 rounded">
              <div className="text-xs font-bold text-red-700 mb-1">
                ⚠️ 위험 작업
              </div>
              {meta.dangerNote && (
                <div className="text-[11px] text-red-700 leading-relaxed whitespace-pre-wrap">
                  {meta.dangerNote}
                </div>
              )}
            </div>
          )}

          {/* 입력 파라미터 (메타 표) */}
          <Section
            title={`📥 입력 파라미터 (${meta.inputs?.length ?? 0})`}
          >
            {!meta.inputs || meta.inputs.length === 0 ? (
              <div className="text-xs text-gray-400">없음</div>
            ) : (
              <table className="w-full text-xs border border-gray-200 rounded overflow-hidden text-gray-900">
                <thead>
                  <tr className="bg-gray-100 text-gray-800 text-[11px]">
                    <th className="text-left px-2 py-1.5 border-b border-gray-200">name</th>
                    <th className="text-left px-2 py-1.5 border-b border-gray-200">type</th>
                    <th className="text-left px-2 py-1.5 border-b border-gray-200">required</th>
                    <th className="text-left px-2 py-1.5 border-b border-gray-200">sample</th>
                    <th className="text-left px-2 py-1.5 border-b border-gray-200">설명</th>
                  </tr>
                </thead>
                <tbody>
                  {meta.inputs.map((inp) => (
                    <tr key={inp.name} className="border-b border-gray-100 last:border-b-0">
                      <td className="px-2 py-1.5 font-mono text-gray-900">{inp.name}</td>
                      <td className="px-2 py-1.5 text-gray-800">{inp.type}</td>
                      <td className="px-2 py-1.5">
                        {inp.required ? (
                          <span className="text-red-600">✓</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-gray-900">{inp.sample}</td>
                      <td className="px-2 py-1.5 text-gray-800">{inp.description ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {/* 응답 스키마 */}
          <Section title="📤 응답 스키마">
            <pre className="text-[11px] bg-gray-900 text-gray-100 p-3 rounded overflow-x-auto leading-relaxed">
              {meta.outputSchema}
            </pre>
          </Section>

          {/* 특이사항 — manifest scanner 가 비-리터럴(문자열 concat 등)을 파싱하면
              `{ __nonLiteral, kind }` 객체로 들어옴. 객체일 땐 안내 문구로 대체. */}
          {meta.notes &&
            (typeof meta.notes === "string" ? (
              <Section title="📌 특이사항 / 메모">
                <PreText>{meta.notes}</PreText>
              </Section>
            ) : (
              <Section title="📌 특이사항 / 메모">
                <PreText>
                  (notes 가 단일 문자열 리터럴이 아니라 표시 불가 — route.ts 의 notes 를 한 줄 문자열로 합쳐주세요.)
                </PreText>
              </Section>
            ))}

          {/* 라이브 테스터 — endpoint/method 변경 시 입력 sample 재초기화를 위해 key 부여 */}
          <LiveTester
            key={`${endpoint.id}:${activeMethod.method}`}
            path={endpoint.path}
            method={activeMethod.method}
            meta={meta}
          />
        </>
      )}

      {/* 파일 위치 */}
      <Section title="📂 핸들러 + 메타 파일">
        <div className="text-xs font-mono text-gray-500 break-all">
          web/{endpoint.filePath}
          {activeMethod.metaLine > 0 && `:${activeMethod.metaLine}`}
        </div>
        {activeMethod.metaExportName && (
          <div className="text-[10px] text-gray-400 mt-0.5">
            export 이름: <code>{activeMethod.metaExportName}</code>
          </div>
        )}
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
