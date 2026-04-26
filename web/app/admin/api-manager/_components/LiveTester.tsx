"use client";

/**
 * 라이브 테스터 — 실제 endpoint 를 호출해 응답을 보여줌.
 *
 * 동작:
 *   - meta.inputs 기반으로 입력 폼 자동 생성 (sample 값을 기본값으로)
 *   - GET/DELETE  → querystring 으로 전송
 *   - POST/PATCH/PUT → JSON body 로 전송 (Content-Type: application/json)
 *   - cache: "no-store" 강제 (의뢰자 요구 — 매번 라이브)
 *   - 응답 시간 (performance.now), HTTP status, headers, body 표시
 *
 * 위험 작업 (meta.dangerous):
 *   - 빨간 경고 박스 + dangerNote
 *   - "이해함" 체크박스 활성 시만 실행 버튼 활성
 *
 * 보조:
 *   - URL 복사 / curl 복사 / 응답 복사
 *   - 재호출 버튼
 */

import { useMemo, useState } from "react";
import type { EndpointMeta, HttpMethod, MetaInput } from "../_lib/types";

interface Props {
  path: string;
  method: HttpMethod;
  meta: EndpointMeta;
}

interface ResponseInfo {
  status: number;
  statusText: string;
  elapsedMs: number;
  headers: Record<string, string>;
  bodyText: string;
  bodyJson: unknown | null;
  url: string;
  error: string | null;
}

const HAS_BODY: Record<HttpMethod, boolean> = {
  GET: false,
  DELETE: false,
  POST: true,
  PATCH: true,
  PUT: true,
};

export default function LiveTester({ path, method, meta }: Props) {
  // 입력 폼 상태 — sample 값을 기본값으로
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    (meta.inputs ?? []).forEach((i) => {
      init[i.name] = i.sample;
    });
    return init;
  });

  const [confirmed, setConfirmed] = useState(false);
  const [response, setResponse] = useState<ResponseInfo | null>(null);
  const [loading, setLoading] = useState(false);

  // 현재 입력값 기준 미리보기 URL
  const previewUrl = useMemo(() => {
    if (HAS_BODY[method]) return path;
    const qs = buildQuerystring(meta.inputs ?? [], values);
    return qs ? `${path}?${qs}` : path;
  }, [path, method, meta.inputs, values]);

  const previewBody = useMemo(() => {
    if (!HAS_BODY[method]) return null;
    const body = buildBody(meta.inputs ?? [], values);
    return JSON.stringify(body, null, 2);
  }, [method, meta.inputs, values]);

  // curl 명령어
  const curlCommand = useMemo(() => {
    const parts = [`curl -X ${method}`];
    if (HAS_BODY[method] && previewBody) {
      parts.push(`-H "Content-Type: application/json"`);
      parts.push(`-d '${previewBody.replace(/'/g, "'\\''")}'`);
    }
    parts.push(`'${previewUrl}'`);
    return parts.join(" \\\n  ");
  }, [method, previewUrl, previewBody]);

  async function execute() {
    if (meta.dangerous && !confirmed) return;
    setLoading(true);
    const t0 = performance.now();
    let info: ResponseInfo;
    try {
      const init: RequestInit = {
        method,
        cache: "no-store",
        credentials: "same-origin",
      };
      if (HAS_BODY[method] && previewBody) {
        init.headers = { "Content-Type": "application/json" };
        init.body = previewBody;
      }
      const res = await fetch(previewUrl, init);
      const elapsedMs = performance.now() - t0;
      const text = await res.text();
      let bodyJson: unknown | null = null;
      try {
        bodyJson = JSON.parse(text);
      } catch {}
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      info = {
        status: res.status,
        statusText: res.statusText,
        elapsedMs,
        headers,
        bodyText: text,
        bodyJson,
        url: previewUrl,
        error: null,
      };
    } catch (err) {
      info = {
        status: 0,
        statusText: "(fetch 실패)",
        elapsedMs: performance.now() - t0,
        headers: {},
        bodyText: "",
        bodyJson: null,
        url: previewUrl,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    setResponse(info);
    setLoading(false);
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  const canExecute = meta.dangerous ? confirmed && !loading : !loading;

  return (
    <div className="border-t border-gray-200 pt-4 mt-4">
      <div className="text-xs font-semibold text-gray-700 mb-2">
        🚀 라이브 테스트 ({method} {path})
      </div>

      {/* 입력 폼 */}
      {meta.inputs && meta.inputs.length > 0 && (
        <div className="space-y-2 mb-3">
          {meta.inputs.map((input) => (
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

      {/* 미리보기 */}
      <div className="bg-gray-50 border border-gray-200 rounded p-2 mb-3 space-y-1.5">
        <div className="text-[10px] text-gray-500">미리보기</div>
        <div className="font-mono text-[11px] text-gray-800 break-all">
          <span className={`inline-block px-1.5 py-0.5 rounded mr-2 text-[10px] font-bold ${methodColor(method)}`}>
            {method}
          </span>
          {previewUrl}
        </div>
        {previewBody && (
          <pre className="text-[10px] bg-gray-900 text-gray-100 p-2 rounded overflow-x-auto">
            {previewBody}
          </pre>
        )}
      </div>

      {/* 위험 작업 confirm */}
      {meta.dangerous && (
        <div className="bg-red-50 border-2 border-red-400 rounded p-3 mb-3">
          <div className="text-xs font-bold text-red-700 mb-1.5">
            ⚠️ 위험 작업
          </div>
          {meta.dangerNote && (
            <div className="text-[11px] text-red-700 mb-2 leading-relaxed whitespace-pre-wrap">
              {meta.dangerNote}
            </div>
          )}
          <label className="flex items-center gap-2 text-[11px] text-red-800 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="w-3.5 h-3.5"
            />
            위 사항 이해했고 실제로 실행을 원합니다 (캐시 없음, 즉시 반영됨)
          </label>
        </div>
      )}

      {/* 액션 버튼 */}
      <div className="flex gap-2 flex-wrap mb-3">
        <button
          onClick={execute}
          disabled={!canExecute}
          className={`text-xs px-3 py-1.5 rounded font-semibold transition-colors ${
            !canExecute
              ? "bg-gray-200 text-gray-400 cursor-not-allowed"
              : meta.dangerous
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "bg-blue-600 hover:bg-blue-700 text-white"
          }`}
        >
          {loading ? "호출 중..." : response ? "재호출" : meta.dangerous ? "⚠ 실행" : "호출"}
        </button>
        <button
          onClick={() => copy(previewUrl)}
          className="text-xs px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 text-gray-700"
        >
          📋 URL 복사
        </button>
        <button
          onClick={() => copy(curlCommand)}
          className="text-xs px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 text-gray-700"
        >
          📋 curl 복사
        </button>
      </div>

      {/* 응답 */}
      {response && <ResponseView response={response} onCopy={copy} />}
    </div>
  );
}

// ────────────────────────────────────────────────
// 입력 폼 1행

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
// 응답 표시

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
      {/* 응답 헤더 라인 */}
      <div className="bg-gray-50 border-b border-gray-200 px-3 py-2 flex items-center gap-3 flex-wrap">
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${statusColor}`}>
          {response.error ? "ERR" : `${response.status} ${response.statusText}`}
        </span>
        <span className={`text-xs font-mono font-semibold ${timeColor}`}>
          {response.elapsedMs.toFixed(0)} ms
        </span>
        <span className="text-[10px] text-gray-500 font-mono truncate flex-1">
          {response.url}
        </span>
        <button
          onClick={() => onCopy(prettyBody)}
          className="text-[10px] px-2 py-0.5 rounded border border-gray-300 hover:bg-white text-gray-600"
        >
          📋 응답 복사
        </button>
      </div>

      {/* 에러 (네트워크 실패 등) */}
      {response.error && (
        <div className="px-3 py-2 bg-red-50 text-xs text-red-700 border-b border-red-200">
          <div className="font-semibold mb-0.5">네트워크 에러</div>
          <div className="font-mono">{response.error}</div>
        </div>
      )}

      {/* 응답 헤더 */}
      <details className="border-b border-gray-200">
        <summary className="cursor-pointer px-3 py-1.5 text-[11px] text-gray-600 hover:bg-gray-50">
          응답 헤더 ({Object.keys(response.headers).length})
        </summary>
        <div className="px-3 py-2 bg-gray-50 text-[10px] font-mono">
          {Object.entries(response.headers).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-gray-500 min-w-[140px]">{k}:</span>
              <span className="text-gray-800 break-all">{v}</span>
            </div>
          ))}
        </div>
      </details>

      {/* 응답 body */}
      <div className="p-3">
        <div className="text-[10px] text-gray-500 mb-1">
          Body {response.bodyJson ? "(JSON pretty)" : "(raw text)"}
          {tooLong && <span className="text-amber-600 ml-2">⚠ {prettyBody.split("\n").length} 줄</span>}
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

// ────────────────────────────────────────────────
// helpers

function buildQuerystring(inputs: MetaInput[], values: Record<string, string>): string {
  const qs = new URLSearchParams();
  for (const input of inputs) {
    const v = values[input.name];
    if (v != null && v !== "") qs.set(input.name, v);
  }
  return qs.toString();
}

function buildBody(
  inputs: MetaInput[],
  values: Record<string, string>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const input of inputs) {
    const v = values[input.name];
    if (v == null || v === "") continue;
    if (input.type === "number") {
      const n = Number(v);
      body[input.name] = Number.isFinite(n) ? n : v;
    } else if (input.type === "boolean") {
      body[input.name] = v === "true";
    } else {
      body[input.name] = v;
    }
  }
  return body;
}

function methodColor(method: HttpMethod): string {
  switch (method) {
    case "GET":
      return "bg-green-200 text-green-800";
    case "POST":
      return "bg-blue-200 text-blue-800";
    case "PATCH":
    case "PUT":
      return "bg-amber-200 text-amber-800";
    case "DELETE":
      return "bg-red-200 text-red-800";
  }
}
