import type { ExternalServiceMeta } from "../types";

export const meta: ExternalServiceMeta = {
  id: "github-actions",
  name: "GitHub Actions (KEPCO 크롤링 실행 플랫폼)",
  category: "infra",
  consoleUrl: "https://github.com/hicor150010/project_kepco_powermap/actions",
  envKeys: ["GH_PAT", "GITHUB_REPO"],
  expiry: null,
  dailyLimit: "Public repo 무제한 (동시 Job 20개, 스토리지 500 MB)",
  issueGuide: `1. https://github.com 로그인
2. 리포지토리: hicor150010/project_kepco_powermap (Public — Actions 무제한)
3. Personal Access Token 발급:
   - Settings → Developer settings → Personal access tokens → Fine-grained tokens
   - **Workflow 스코프 필수** (workflow.yml dispatch + push 권한)
   - .env.local 의 GH_PAT 에 등록
4. GitHub Secrets 등록 (리포지토리 Settings → Secrets):
   - SUPABASE_URL / SUPABASE_SERVICE_KEY
   - KAKAO_REST_KEY
5. GITHUB_REPO 환경변수: "hicor150010/project_kepco_powermap" 형식`,
  usageExample: `# Workflow 트리거 (REST API)
POST https://api.github.com/repos/{owner}/{repo}/actions/workflows/crawl.yml/dispatches
Headers:
  Authorization: Bearer \${GH_PAT}
  Accept: application/vnd.github+json
Body:
  { "ref": "main", "inputs": { "thread": "1", "regions": "..." } }

# Workflow 취소
POST .../actions/runs/{run_id}/cancel`,
  notes: `- ⚠️ GH_PAT 만료 주의 — 일반적으로 1년. 만료 시 모든 크롤링 중단
- Public repo 라 Actions 무제한 무료 (Private 이면 2,000분/월 제한)
- 동시 3개 스레드 사용 중 (concurrency group 분리)
- Job 당 최대 6시간 → 3시간 체이닝으로 해결
- 상세 아키텍처: docs/CRAWLING.md`,
};
