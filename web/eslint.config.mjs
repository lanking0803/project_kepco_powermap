import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // 운영 코드 — `_` prefix 변수는 의도적 미사용으로 인정.
  // (예: 미구현 콜백 자리표시자 `_props`, props 분해 시 미사용 `_onDelete`)
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      // React 19 Compiler 가 새로 도입한 룰들 — Compiler 최적화를 위한 권장사항.
      // 우리 코드 패턴(외부 시스템 동기화 / 콜백 ref 안정화 / 의도적 빈 deps)은
      // 합리적이며 빌드/운영 통과. Compiler 최적화 미적용 정도의 영향만 있음.
      // 13개 파일에 inline disable 박기보다 전역 비활성화가 깔끔.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  },

  // scripts/ — 일회용 검증 스크립트. any 허용 (외부 응답 raw 다룸).
  {
    files: ["scripts/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
]);

export default eslintConfig;
