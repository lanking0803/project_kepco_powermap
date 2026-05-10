---
name: GitHub 계정 이력 (hicor1 → hicor150010 → sunlap2026)
description: 2026-04-19 1차 이전, 2026-05-08 ToS 정지, 2026-05-09 신규 계정 이전 완료. 정지 사유 + 시정 흐름 + 운영 영향.
type: reference
---

# 현재 운영 계정 (2026-05-09~)

- **GitHub**: `sunlap2026` (`sunlap2026@gmail.com` Google OAuth)
- **저장소**: https://github.com/sunlap2026/project_kepco_powermap (**Private**)
- **로컬 git config**: `user.email=sunlap2026@gmail.com`, `user.name=sunlap2026`
- **PAT**: `docs/SECRETS.local.md` 의 GitHub 섹션 참조 (ghp_F3bx... — 채팅 1회 노출, 폐기 검토 필요)

⛔ **GitHub Actions 사용 절대 금지** — 이전 정지 사유. `.github/workflows/` 폴더 자체 미존재.
- PAT 도 `repo` 만 발급 (`workflow` 스코프 X) → 워크플로 푸시 자체가 차단되어 약관 재위반 자동 방어.

---

# 🚨 2026-05-08 정지 사고 (영구 추정)

## 정지된 계정
- `hicor150010` (`hicor150010@gmail.com`)
- 저장소 `hicor150010/project_kepco_powermap` 접근 불가

## 정지 사유 (GitHub Support 명시)
> "any repositories that use GitHub Actions **solely to interact with 3rd party websites**, to engage in incentivized activities, or **for general computing purposes** may fall afoul of the GitHub Additional Product Terms"

= **GitHub Actions Additional Product Terms 위반**
- GitHub Actions = CI/CD 용도가 원칙
- 우리 사용: KEPCO API + data.go.kr + Supabase 외부 DB 자동 적재 = "general computing"
- 5스레드 / matrix / auto_continue 자체는 무관, **외부 사이트 자동 호출 패턴 자체가 위반**

## Support 시도 결과 (모두 거절)
- **티켓 #4365978** (2026-05-08 21:33): 위반 사유 미인지 + 부인 → 1시간 40분 만에 거절 자동응답
- **티켓 #4366297** (2026-05-08 23:23): 위반 인정 + 시정 약속 4단계 + 이전 티켓 참조 → 약 17시간 후 같은 정형 거절 답변 ("not be removing the restrictions")

→ 2회 모두 동일한 거절 텍스트 = AI 보조 자동 분류 의심 + 정책상 단호함
→ 영구 정지 추정. 추가 시도 없이 신규 계정으로 이전 결정.

## 사전 통보 없었음
- 2FA 등록 안내 메일 (6/8 마감) 만 수신 — 정지와 무관
- ToS 위반 통보 메일 0건

---

# 2026-05-09 신규 계정 이전 (완료)

## 의뢰자 결정 논리
- "GitHub Actions 안 쓸 거면 정지될 사유 없음"
- 신규 계정 + Cloud Run 이전 = 합법 운영
- 같은 PC/IP 사용해도 약관 위반 행위 없으면 추적·재정지 명분 없음

## 처리 흐름
1. ✅ 새 Google 계정 `sunlap2026@gmail.com` 가입
2. ✅ 새 GitHub 가입 (`sunlap2026`) + Private 저장소
3. ✅ 로컬 origin 교체 + PAT 발급 (`repo` 스코프만)
4. ⚠️ 첫 푸시 시 워크플로 권한 거부 (`workflow scope` 필요) → **워크플로 4개 git rm + 커밋 → 푸시 성공**
5. ✅ git config user.email/name 을 sunlap2026 으로 변경 (Vercel commit author 매칭)
6. ✅ Vercel 의 GitHub App 을 sunlap2026 에 설치 + 새 저장소 연결 (Settings → Git)
7. ✅ 빈 커밋 (200a42d) push → Vercel 자동 배포 정상 작동 확인
8. ✅ sunlap.kr 운영 정상 (다운타임 0)

## 삭제된 워크플로 (정지 사유 자체 제거)
- `.github/workflows/crawl.yml` — KEPCO 5스레드 24/7 수집
- `.github/workflows/cleanup.yml`
- `.github/workflows/prep_caches.yml` — Supabase 캐시 prep
- `.github/workflows/solar_permits_collect.yml` — 월 1회 솔라 수집

## 운영 영향
- ✅ **sunlap.kr 정상** (Vercel 자동 배포 sunlap2026 기반)
- ⛔ **자동 데이터 수집 일시 중단** — Cloud Run Worker Pool 이전까지
- ✅ 코드/커밋 히스토리 100% 보존 (259+ 커밋)

---

# 이전 작업 시 배운 것

## PAT 인증 (검증된 패턴)
- Windows Git Credential Manager 에 옛 계정 캐시 남으면 새 저장소 push 시 403
- 회피: PAT 를 URL 에 직접 끼워서 push (`https://user:pat@github.com/...`)
- 푸시 성공 후 즉시 URL 에서 PAT 제거 (`git remote set-url origin https://github.com/...`)

## Vercel commit author 매칭 차단
- Vercel 배포가 "Deployment Blocked - commit email could not be matched to a GitHub account" 로 차단되는 경우
- 원인: 로컬 git config `user.email` 이 정지/삭제된 계정 메일
- 해결: `git config user.email <새 계정 메일>` + 새 빈 커밋 push

## Vercel 환경변수
- GitHub 연결 swap 해도 환경변수 보존됨 (재등록 불필요)
- 단 `GITHUB_PAT` 같이 PAT 값 자체가 바뀌는 변수는 수동 업데이트 필요

## GitHub Actions Secrets
- 저장소 소속이라 새 저장소에 수동 재등록 필수 (자동 이전 안 됨)
- 단 우리는 워크플로 자체를 안 쓸 거라 해당 없음

---

# 과거 이력 (참고)

## hicor1 → hicor150010 (2026-04-19)
- 1차 이전 완료, 구 저장소/PAT 모두 삭제됨
- 외부 문서/블로그에 `github.com/hicor1/...` 링크 보이면 모두 404

## hicor150010 → sunlap2026 (2026-05-09)
- 2차 이전. ToS 정지로 강제 이전.
- 구 저장소는 정지 상태로 영구 잔존 (의뢰자가 삭제 불가 — 정지된 계정은 본인 삭제 X)
