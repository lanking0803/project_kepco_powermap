"use client";

/**
 * 외부 서비스 라이브 테스터 — service.sampleRequest 기반 입력 폼 + 호출.
 *
 * 동작:
 *   - sampleRequest.inputs 로 폼 자동 생성 (sample 값 기본)
 *   - 클라이언트가 직접 외부 호출 X — `/api/admin/external-test` 프록시 경유
 *     (서버에서 placeholder {ENV_KEY} 치환 + 키 노출 방지)
 *   - 응답 status / 시간 / body 표시 (LiveTester 와 동일 패턴)
 */

import { useState } from "react";
import type { ExternalSampleRequest, MetaInput } from "../_lib/types";

interface Props {
  serviceId: string;
  sample: ExternalSampleRequest;
}

interface ResponseInfo {
  status: number;
  statusText: string;
  elapsedMs: number;
  requestUrl: string;
  requestMethod: string;
  bodyText: string;
  bodyJson: unknown | null;
  error: string | null;
}

export default function ExternalLiveTester({ serviceId, sample }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    (sample.inputs ?? []).forEach((i) => {
      init[i.name] = i.sample;
    });
    return init;
  });

  const [response, setResponse] = useState<ResponseInfo | null>(null);
  const [loading, setLoading] = useState(false);

  async function execute() {
    setLoading(true);
    const t0 = performance.now();
    let info: ResponseInfo;
    try {
      const res = await fetch("/api/admin/external-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "same-origin",
        body: JSON.stringify({ serviceId, values }),
      });
      const data = await res.json();
      info = {
        status: data.status ?? res.status,
        statusText: data.statusText ?? res.statusText,
        elapsedMs: data.elapsedMs ?? performance.now() - t0,
        requestUrl: data.requestUrl ?? "",
        requestMethod: data.requestMethod ?? sample.method,
        bodyText: data.bodyText ?? "",
        bodyJson: data.bodyJson ?? null,
        error: data.error ?? (res.ok ? null : data.error ?? `프록시 ${res.status}`),
      };
    } catch (err) {
      info = {
        status: 0,
        statusText: "(프록시 호출 실패)",
        elapsedMs: performance.now() - t0,
        requestUrl: "",
        requestMethod: sample.method,
        bodyText: "",
        bodyJson: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    setResponse(info);
    setLoading(false);
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  return (
    <div className="border-t border-gray-200 pt-4 mt-4">
      <div className="text-xs font-semibold text-gray-700 mb-2">
        🚀 라이브 호출 ({sample.method})
      </div>
      {sample.description && (
        <div className="text-[11px] text-gray-600 mb-3">{sample.description}</div>
      )}

      {/* 입력 폼 */}
      {sample.inputs && sample.inputs.length > 0 && (
        <div className="space-y-2 mb-3">
          {sample.inputs.map((input) => (
            <InputRow
              key={input.name}
              input={input}
              value={values[input.name] ?? ""}
              onChange={(v) =>
                setValues((prev) => ({ ...prev, [input.name]: v }))
              }
            />
          ))}
        </div>
      )}

      {/* 미리보기 (placeholder 그대로 — 키 노출 방지) */}
      <div className="bg-gray-50 border border-gray-200 rounded p-2 mb-3">
        <div className="text-[10px] text-gray-500 mb-1">호출 대상 (실제 키는 서버에서 치환)</div>
        <div className="font-mono text-[11px] text-gray-800 break-all">
          <span className="inline-block px-1.5 py-0.5 rounded mr-2 text-[10px] font-bold bg-green-200 text-green-800">
            {sample.method}
          </span>
          {sample.url}
        </div>
      </div>

      {/* 액션 버튼 */}
      <div className="flex gap-2 flex-wrap mb-3">
        <button
          onClick={execute}
          disabled={loading}
          className={`text-xs px-3 py-1.5 rounded font-semibold transition-colors ${
            loading
              ? "bg-gray-200 text-gray-400 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-700 text-white"
          }`}
        >
          {loading ? "호출 중..." : response ? "재호출" : "호출"}
        </button>
      </div>

      {/* 응답 */}
      {response && <ResponseView response={response} onCopy={copy} />}
    </div>
  );
}

// ────────────────────────────────────────────────
// 입력 폼 1행 (LiveTester 와 동일 구조)

function InputRow({
  input,
  value,
  onChange,
}: {
  input: MetaInput;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 items-start">
      <div className="pt-1.5 text-xs font-mono text-gray-700">
        {input.name}
        {input.required && <span className="text-red-500 ml-0.5">*</span>}
        <span className="ml-1 text-[10px] text-gray-400">({input.type})</span>
      </div>
      <div>
        {input.type === "boolean" ? (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="text-xs px-2 py-1 border border-gray-300 rounded text-gray-900 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="false">false</option>
            <option value="true">true</option>
          </select>
        ) : (
          <input
            type={input.type === "number" ? "number" : "text"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={input.sample}
            className="w-full text-xs px-2 py-1 border border-gray-300 rounded font-mono text-gray-900 bg-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        )}
        {input.description && (
          <div className="text-[10px] text-gray-500 mt-0.5">{input.description}</div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────
// 응답 표시 (LiveTester ResponseView 단순화 버전)

function ResponseView({
  response,
  onCopy,
}: {
  response: ResponseInfo;
  onCopy: (text: string) => void;
}) {
  const statusColor =
    response.error || response.status >= 500
      ? "bg-red-100 text-red-700"
      : response.status >= 400
        ? "bg-amber-100 text-amber-800"
        : response.status >= 200
          ? "bg-green-100 text-green-700"
          : "bg-gray-100 text-gray-700";

  const timeColor =
    response.elapsedMs >= 2000
      ? "text-red-600"
      : response.elapsedMs >= 500
        ? "text-amber-700"
        : "text-green-700";

  const prettyBody = response.bodyJson
    ? JSON.stringify(response.bodyJson, null, 2)
    : response.bodyText;

  const tooLong = prettyBody.split("\n").length > 100;

  return (
    <div className="border border-gray-200 rounded overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-200 px-3 py-2 flex items-center gap-3 flex-wrap">
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${statusColor}`}>
          {response.error ? "ERR" : `${response.status} ${response.statusText}`}
        </span>
        <span className={`text-xs font-mono font-semibold ${timeColor}`}>
          {response.elapsedMs.toFixed(0)} ms
        </span>
        <span className="text-[10px] text-gray-500 font-mono truncate flex-1">
          {response.requestUrl}
        </span>
        <button
          onClick={() => onCopy(prettyBody)}
          className="text-[10px] px-2 py-0.5 rounded border border-gray-300 hover:bg-white text-gray-600"
        >
          📋 응답 복사
        </button>
      </div>

      {response.error && (
        <div className="px-3 py-2 bg-red-50 text-xs text-red-700 border-b border-red-200">
          <div className="font-semibold mb-0.5">호출 실패</div>
          <div className="font-mono">{response.error}</div>
        </div>
      )}

      <div className="p-3">
        <div className="text-[10px] text-gray-500 mb-1">
          Body {response.bodyJson ? "(JSON pretty)" : "(raw text)"}
          {tooLong && (
            <span className="text-amber-600 ml-2">
              ⚠ {prettyBody.split("\n").length} 줄
            </span>
          )}
        </div>
        {tooLong ? (
          <details>
            <summary className="cursor-pointer text-[11px] text-blue-600 hover:underline mb-2">
              전체 펼치기
            </summary>
            <pre className="text-[11px] bg-gray-900 text-gray-100 p-3 rounded overflow-auto max-h-96 leading-relaxed">
              {prettyBody}
            </pre>
          </details>
        ) : (
          <pre className="text-[11px] bg-gray-900 text-gray-100 p-3 rounded overflow-auto max-h-96 leading-relaxed">
            {prettyBody}
          </pre>
        )}
      </div>
    </div>
  );
}
