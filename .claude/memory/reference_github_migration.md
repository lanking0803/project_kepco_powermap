---
name: GitHub 계정 이전 + 정지 사고 (hicor1 → hicor150010)
description: 2026-04-19 계정 이전, 2026-05-08 ToS 위반 정지(오탐 의심) 발생. 진행 상황 추적용.
type: reference
---

## 🚨 2026-05-08 정지 사고 — 진행 중

- **증상**: `git push` 시 403 + 로그인 화면에 "Access to your account has been suspended due to a violation of our Terms of Service"
- **사전 통보**: 없음 (2FA 등록 안내 메일만 받음, 6/8 마감 안내였고 무관)
- **로그인 방식**: Google OAuth (`hicor150010@gmail.com`)
- **추정 원인**: GitHub 자동 탐지(Abuse Engine) 오탐 가능성 매우 높음
  - 트리거 후보: ① 오프라인 작업 후 일괄 푸시 ② Actions 5스레드 + 5h50m 자기 트리거 패턴 ③ KEPCO 크롤러의 UA 랜덤화/세션 재생성 코드 ④ hicor1 → hicor150010 이전 후 활동 급증
- **Support 티켓 1차**: **#4365978** (2026-05-08 21:33 접수)
  - 1차 응답 (2026-05-08 23:03): **위반 사유 명시 + 거절**
  - 사유: "GitHub Actions solely to interact with 3rd party websites... general computing purposes" — Additional Product Terms 위반
  - 답장 후 자동 종결 ("ticket closed and cannot be reopened")
- **Support 티켓 2차**: **#4366297** (2026-05-08 23:23 접수)
  - 위반 인정 + 시정 약속(워크플로 비활성화 + 외부 인프라 이전 2주 내) + 이전 티켓 #4365978 참조
  - 응답 대기 중
- **확정된 정지 사유 = GitHub Actions Additional Product Terms 위반**
  - GitHub Actions = CI/CD 용도가 원칙
  - 우리 사용: KEPCO 외부 사이트 호출 + Supabase 외부 DB 저장 = "general computing" 으로 분류
  - 5스레드 / matrix / auto_continue 자체는 무관, **외부 사이트 자동 호출 패턴 자체가 위반**
- **로컬 상태**: 커밋 2건 (1edd436, 5518799) 푸시 대기 중. 코드/데이터 안전.
- **운영 영향**: sunlap.kr 운영본 정상 / 신규 배포 막힘 / GitHub Actions 자동 수집 일시 중단
- **다중 계정 의혹 — 해소**: `hicor0803@gmail.com` 은 GitHub 계정 미보유 (의뢰자 헷갈림). GitHub 계정은 `hicor150010` 단일.

## 해제 시 즉시 시정 약속 (2차 티켓 명시)

24시간 내:
- `.github/workflows/crawl.yml` 비활성화/삭제
- `.github/workflows/solar_permits_collect.yml` 비활성화
- `.github/workflows/prep_caches.yml` 비활성화
- 비활성화 commit 푸시 + 캡처 보관

2주 내:
- 외부 인프라 이전 (KEPCO 수집 + 솔라 발전 정보)
- 이전 옵션 미정 (Vercel Cron / Supabase Edge / VPS 중 결정)

영구 준수:
- GitHub Actions = CI/CD 전용 (테스트/빌드/타입체크)
- 외부 API 호출 / 데이터 수집 워크플로 절대 금지

### 대기 중 금지 사항
- ❌ 로그인 반복 시도 (자동 차단 강화)
- ❌ 같은 건으로 두 번째 티켓 (우선순위 밀림)
- ❌ 신규 GitHub 계정 생성 (다중 계정 의심 강화)
- ✅ 로컬 코드 작업/커밋 계속 가능
- ✅ 추가 정보는 티켓 메일에 답장으로 추가

## 현재 GitHub 상태 (2026-04-19 이후)

- **저장소**: https://github.com/hicor150010/project_kepco_powermap (Public)
- **계정**: `hicor150010@gmail.com` (Google 소셜)
- **PAT**: `ghp_BMREnU1fn...` (자세한 값은 `docs/SECRETS.local.md`)

## 이전 전 상태 (2026-04-19 이전, 현재 존재하지 않음)

- 저장소: ~~`hicor1/project_kepco_powermap`~~ (삭제됨)
- 계정: ~~`hicor1`~~
- 구 PAT: ~~`ghp_kScOxR4c...`~~ (삭제됨)

## 주의

- 과거 commit message, issue reference, 문서에 `hicor1` 이 등장하면 **옛날 저장소 참조**임
- 혹시 외부 문서/블로그에서 `github.com/hicor1/project_kepco_powermap` 링크를 발견하면 **모두 404** (구 저장소 삭제됨)
- **Archive 나 Fork 로 남겨두지 않았음** — 완전 삭제

## 이전 작업 시 배운 것

- Windows Git Credential Manager 에 구 계정 캐시가 남아있으면 새 저장소 push 시 403 발생 → PAT 를 URL 에 직접 끼워서 push (`https://user:pat@github.com/...`) 후 push 성공하면 URL 에서 PAT 제거하는 방식이 가장 확실
- Vercel GitHub 연동은 재연결 시 **환경변수는 보존**되므로 재등록 불필요 (단, `GITHUB_PAT` 같이 **PAT 값 자체가 바뀌는 변수**는 수동 업데이트 필요)
- GitHub Actions 시크릿은 **저장소 소속**이라 새 저장소에 **수동 재등록 필수** (자동 이전 안 됨)