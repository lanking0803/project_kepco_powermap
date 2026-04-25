#!/usr/bin/env node
/**
 * API 관리자 페이지용 manifest 자동 생성 scanner.
 *
 * 입력:
 *   web/app/api/(**)/route.ts                         → 내부 endpoint meta
 *   web/app/admin/api-manager/_lib/services/(*).ts    → 외부 서비스 meta
 *
 * 출력:
 *   web/app/admin/api-manager/_lib/manifest.generated.ts
 *
 * 결정적 (deterministic): 입력 동일 → 출력 byte-identical.
 * predev/prebuild 자동 실행해도 git diff 노이즈 0.
 *
 * 실행:
 *   node scripts/build-api-manifest.mjs
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const API_DIR = path.join(ROOT, "app", "api");
const SERVICES_DIR = path.join(ROOT, "app", "admin", "api-manager", "_lib", "services");
const OUT_FILE = path.join(ROOT, "app", "admin", "api-manager", "_lib", "manifest.generated.ts");

const HTTP_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"];
const META_NAME_RE = /^meta(GET|POST|PATCH|PUT|DELETE)?$/;

// ─────────────────────────────────────────────────────────────────────────
// File walking

async function walk(dir, predicate, files = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return files;
    throw e;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, predicate, files);
    } else if (predicate(entry.name, full)) {
      files.push(full);
    }
  }
  return files;
}

function relPosix(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join("/");
}

function toUrlPath(routeFile) {
  const rel = path.relative(API_DIR, path.dirname(routeFile)).split(path.sep).join("/");
  return rel === "" ? "/api" : `/api/${rel}`;
}

function pathToId(urlPath) {
  return urlPath.replace(/^\/api\/?/, "").replaceAll("/", "-") || "root";
}

// ─────────────────────────────────────────────────────────────────────────
// AST → JSON literal extraction

function literalToJson(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (node.kind === ts.SyntaxKind.UndefinedKeyword) return null;
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return -Number(node.operand.text);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map(literalToJson);
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out = {};
    for (const p of node.properties) {
      if (ts.isPropertyAssignment(p)) {
        const key =
          ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
        if (key) out[key] = literalToJson(p.initializer);
      }
    }
    return out;
  }
  // 식별자 참조·함수 호출·삼항 등 — meta 는 정적 리터럴이어야 함
  return { __nonLiteral: true, kind: ts.SyntaxKind[node.kind] };
}

function containsNonLiteral(v) {
  if (v && typeof v === "object" && v.__nonLiteral) return true;
  if (Array.isArray(v)) return v.some(containsNonLiteral);
  if (v && typeof v === "object") return Object.values(v).some(containsNonLiteral);
  return false;
}

function parseSource(filePath, src) {
  return ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true);
}

function findExportedConsts(sf, namePattern) {
  const out = [];
  function visit(node) {
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && namePattern.test(d.name.text) && d.initializer) {
          // initializer 가 `as const` 같은 AsExpression 으로 감싸졌을 수 있음 — 풀어냄
          let init = d.initializer;
          while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) {
            init = init.expression;
          }
          const line = sf.getLineAndCharacterOfPosition(d.getStart()).line + 1;
          out.push({
            name: d.name.text,
            line,
            value: literalToJson(init),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}

function findExportedHttpMethods(sf) {
  const found = new Set();
  ts.forEachChild(sf, (node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
      node.name &&
      HTTP_METHODS.includes(node.name.text)
    ) {
      found.add(node.name.text);
    }
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && HTTP_METHODS.includes(d.name.text)) {
          found.add(d.name.text);
        }
      }
    }
  });
  // 결정적 정렬
  return [...found].sort((a, b) => HTTP_METHODS.indexOf(a) - HTTP_METHODS.indexOf(b));
}

// ─────────────────────────────────────────────────────────────────────────
// Scan endpoints

async function scanEndpoints() {
  const routeFiles = await walk(
    API_DIR,
    (name) => name === "route.ts" || name === "route.tsx",
  );
  routeFiles.sort();

  const endpoints = [];
  const warnings = [];

  for (const f of routeFiles) {
    const src = await fs.readFile(f, "utf8");
    const sf = parseSource(f, src);
    const urlPath = toUrlPath(f);
    const id = pathToId(urlPath);
    const filePath = relPosix(f);

    const metaExports = findExportedConsts(sf, META_NAME_RE);
    const methods = findExportedHttpMethods(sf);

    if (methods.length === 0) {
      warnings.push(
        `${urlPath}: HTTP 메서드 export 없음 (route.ts 핸들러 누락 의심)`,
      );
      continue;
    }

    const methodMetas = methods.map((method) => {
      const specific = metaExports.find((e) => e.name === `meta${method}`);
      const generic = metaExports.find((e) => e.name === "meta");
      const chosen = specific ?? generic;

      if (!chosen) {
        warnings.push(
          `${urlPath} ${method}: meta 미정의 — route.ts 에 \`export const meta\` 또는 \`export const meta${method}\` 추가 필요`,
        );
        return { method, meta: null, metaLine: 0, metaExportName: null };
      }
      if (containsNonLiteral(chosen.value)) {
        warnings.push(
          `${urlPath} ${method}: meta 가 변수 참조/함수 호출 포함 — 정적 리터럴만 가능`,
        );
      }
      return {
        method,
        meta: chosen.value,
        metaLine: chosen.line,
        metaExportName: chosen.name,
      };
    });

    endpoints.push({ path: urlPath, id, filePath, methods: methodMetas });
  }

  return { endpoints, warnings };
}

// ─────────────────────────────────────────────────────────────────────────
// Scan external services

async function scanServices() {
  const serviceFiles = await walk(
    SERVICES_DIR,
    (name) => name.endsWith(".ts") && !name.endsWith(".d.ts"),
  );
  serviceFiles.sort();

  const services = [];
  const warnings = [];

  for (const f of serviceFiles) {
    const src = await fs.readFile(f, "utf8");
    const sf = parseSource(f, src);
    const filePath = relPosix(f);

    const metas = findExportedConsts(sf, /^meta$/);
    if (metas.length === 0) {
      warnings.push(
        `${filePath}: \`export const meta\` 없음 — 외부 서비스 파일은 meta export 필수`,
      );
      continue;
    }
    const m = metas[0];
    if (containsNonLiteral(m.value)) {
      warnings.push(
        `${filePath}: meta 에 변수 참조/함수 호출 포함 — 정적 객체만 가능`,
      );
    }
    services.push({ ...m.value, filePath, metaLine: m.line });
  }

  return { services, warnings };
}

// ─────────────────────────────────────────────────────────────────────────
// Cross-validation + consumedBy 자동 계산

function deriveConsumedBy(endpoints, services) {
  const map = new Map(services.map((s) => [s.id, []]));
  for (const ep of endpoints) {
    const externalDeps = new Set();
    for (const m of ep.methods) {
      const deps = m.meta?.externalDeps;
      if (Array.isArray(deps)) deps.forEach((d) => externalDeps.add(d));
    }
    for (const dep of externalDeps) {
      if (map.has(dep)) map.get(dep).push(ep.id);
    }
  }
  return services.map((s) => ({
    ...s,
    consumedBy: (map.get(s.id) ?? []).sort(),
  }));
}

function validateRefs(endpoints, services, warnings) {
  const serviceIds = new Set(services.map((s) => s.id));
  for (const ep of endpoints) {
    for (const m of ep.methods) {
      const deps = m.meta?.externalDeps ?? [];
      if (!Array.isArray(deps)) continue;
      for (const d of deps) {
        if (typeof d === "string" && !serviceIds.has(d)) {
          warnings.push(
            `${ep.path} ${m.method}: externalDeps "${d}" 가 _lib/services/ 에 정의 안 됨`,
          );
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Output

function renderManifestFile(manifest) {
  return `// AUTO-GENERATED by scripts/build-api-manifest.mjs — DO NOT EDIT.
// 재생성: \`npm run dev\` / \`npm run build\` (predev/prebuild 훅) 또는 \`npm run manifest\`.
// 결정적 출력 — 같은 입력이면 byte-identical.

import type { GeneratedManifest } from "./types";

export const MANIFEST: GeneratedManifest = ${JSON.stringify(manifest, null, 2)} as GeneratedManifest;
`;
}

async function main() {
  const epRes = await scanEndpoints();
  const svcRes = await scanServices();
  const warnings = [...epRes.warnings, ...svcRes.warnings];

  const services = deriveConsumedBy(epRes.endpoints, svcRes.services);
  validateRefs(epRes.endpoints, services, warnings);

  warnings.sort();

  const manifest = {
    endpoints: epRes.endpoints,
    services,
    warnings,
  };

  const out = renderManifestFile(manifest);

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  let prev = "";
  try {
    prev = await fs.readFile(OUT_FILE, "utf8");
  } catch {}

  if (prev !== out) {
    await fs.writeFile(OUT_FILE, out, "utf8");
    console.log(
      `[api-manifest] ${manifest.endpoints.length} endpoints · ${manifest.services.length} services → ${path.relative(ROOT, OUT_FILE)}`,
    );
  } else {
    console.log(
      `[api-manifest] no changes (${manifest.endpoints.length} endpoints · ${manifest.services.length} services)`,
    );
  }

  if (warnings.length) {
    console.warn(`[api-manifest] ⚠ ${warnings.length} warning(s):`);
    for (const w of warnings) console.warn(`  · ${w}`);
  }
}

main().catch((err) => {
  console.error("[api-manifest] failed:", err);
  process.exit(1);
});
