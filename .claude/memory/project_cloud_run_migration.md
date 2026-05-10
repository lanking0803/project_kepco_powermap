---
name: 데이터 수집 인프라 이전 — GitHub Actions → Google Cloud Run
description: GitHub ToS 정지(2026-05-08)로 인한 강제 이전. Cloud Run Worker Pool 채택. PoC 부터 시작.
type: project
---

# 🎯 의뢰자 우선순위 (확정)

1. **17개 시도 동시 병렬 운영 필수** — 시도당 5일/사이클, 17개 동시면 5일/전국. 순차는 85일이라 불가.
2. **다중 IP는 선택사항** (있으면 좋음, 없어도 OK)
3. **수집기 확장 가능 구조** — 17 KEPCO + 10 필지 + 1 솔라 = 28개 컨테이너 동시 가능해야

# 🏆 채택 = Google Cloud Run Worker Pool

## 비교 결과 (2026-05-09 검증)

| 옵션 | 결정 |
|---|---|
| GitLab CI/CD | ❌ 동일 약관 위반 위험 |
| Supabase Edge Functions (Free/Pro) | ❌ Wall clock 150~400초 한도 + Python→TS 재작성 + 단일 region |
| Naver Cloud Functions | ❌ 한국 region 만 + 다중 IP X |
| Cloudflare Workers | ❌ 30초 한도 (Free) |
| Oracle Cloud Always Free | ❌ capacity 부족으로 가입 불가 (의뢰자 직접 시도 실패) |
| AWS Lambda 다중 region | △ 15분 한도 = 분할 부담 큼 |
| AWS EC2 / Vultr VPS | △ 단일 IP, 월 $12~25 |
| 사무실 PC + 작업 스케줄러 | △ 단일 IP + 24/7 부담 |
| **Cloud Run Worker Pool** ⭐ | ✅ 24/7 무한 / 컨테이너 / 무료 한도 / 자동 배포 |

## Worker Pool 채택 이유 (공식 문서 검증)
- **연속 실행 무제한** (HTTP request timeout 무관) ⭐ 핵심
- **2026년 4월 GA** — Google 공식 백그라운드 워크로드 전용 (Estee Lauder 사례)
- **Service / Job 보다 ~40% 저렴** (공식 자료)
- **컨테이너 기반** — Python 도커 그대로 재사용
- **단일 GitHub 저장소 + 환경변수로 28개 서비스 분리 가능**

## 현실적 운영비 추정
- Cloud Run Worker Pool: 약 **$15~25/월** (KEPCO 17개 24/7 + 필지 분기 1회 + 솔라 월 1회)
- Supabase Pro: $25/월 (저장공간 확장 별도 계획)
- **합계: 월 $40~50 (한화 약 5만~6.6만원)**
- 의뢰자 부담 합의 필요

# ⚠️ Cloud Run 의 한계 (정확한 사실)

- **한국 region asia-northeast3 = Tier 2 가격** (Tier 1 도쿄 대비 약 30% 비쌈, 무료 한도는 동일)
- **무료 outbound 1GB/월은 북미만** — 한국 region outbound 는 $0.12~0.19/GB
- **Maximum Instances cap 필수** — 악의 트래픽 폭증 시 폭탄 청구 방어
- **KEPCO API 가 Cloud Run IP 받아주는지 PoC 필요** (기존 GitHub Actions 는 AWS US 였음)

# 📋 진행 계획

## Phase 0: PoC (1~2일)
1. Google Cloud 가입 (`sunlap2026@gmail.com`, **새 카드 — 잔액 적은 체크카드 권장**)
2. **Budget alerts $30 + Auto-disable on $50 설정** (가입 직후 즉시)
3. 프로젝트 생성 (`sunlap-crawler` 류) + API 4개 활성화 (Cloud Run / Cloud Build / Container Registry / Cloud Logging)
4. 로컬 gcloud CLI + Docker Desktop 설치
5. 단순 PoC 컨테이너 (`crawler_poc/poc_worker.py`) 작성
   - KEPCO API 1회 호출
   - Supabase bjd_master 1행 조회
   - 5분 sleep 후 종료 (Worker Pool 패턴 검증)
6. 서울 region 배포 → 로그 확인 → 통과/실패 판단
   - 통과: 본 작업 진행
   - KEPCO 차단: 다른 region (도쿄/싱가포르) 시도
   - 모두 차단: 다른 옵션 재검토 (VPS 등)

## Phase 1: 코드 재구성 (1주)
- `Dockerfile` 작성
- `cloud_run_worker.py` 작성 (HTTP entry 없는 무한루프, env 로 시도 지정)
- `auto_continue` 로직 제거 (60분 한도 X = 자기 트리거 불필요)
- 환경변수로 시도/워커 분리

## Phase 2: 배포 + GitHub 자동 연동 (1주)
- Cloud Build 트리거를 GitHub 저장소에 연결 (push → 자동 빌드/배포)
- 17개 시도 Worker Pool 배포 (단일 코드 + 환경변수 분기)
- 필지 10개 Worker Pool 배포 (분기 1회 적재)
- 솔라 → Cloud Run **Job** 으로 (월 1회, 24h 한도 안 여유)

## Phase 3: 검증 + 안정화 (1주)
- 24~72h 모니터링
- KEPCO 차단 발생 여부 / 비용 추적
- 안정 확인

**총 작업: 3~4주**

# 🔗 자동 배포 흐름

```
git push origin main (sunlap2026 저장소)
  ↓ GitHub webhook
Cloud Build (Google) — Dockerfile / Buildpack 빌드
  ↓
Container Registry (gcr.io/{project}/...)
  ↓
Cloud Run Worker Pool — 새 버전 자동 배포
```

- Cloud Build Free Tier: **120 build-minutes/일** (우리 사용 ~10~50분/일 = 무료 안)
- GitHub Actions 같은 자동 배포 경험 그대로 + 약관 안전

# 🛡 안전장치 (반드시 설정)

- **Budget alerts $30/$50/$100** — 메일 알림
- **Auto-disable on budget exceed** — PoC 단계엔 활성화, 운영 시작 후 비활성화 검토
- **Max Instances cap = 5** (서비스별)
- **결제 카드 = 잔액 적은 체크카드** (폭탄 청구 잔액만큼만)

# ⚠️ 절대 하지 말 것

- ❌ GitHub Actions 워크플로 다시 만들기 (정지 사유 재현)
- ❌ 무료 한도 회피용 다중 GCP 계정 생성 (Google 약관 위반)
- ❌ Max Instances 무제한 설정 (악의 트래픽 폭탄)
- ❌ outbound 트래픽 가정 — 실측 후 Tier 1 region 이전 검토

# 📌 진행 상태 (2026-05-10 업데이트)

## Phase 0 PoC 완료 ✅

- ✅ Google Cloud 가입 + 프로젝트 + API 활성화
- ✅ Cloud Build trigger + GitHub 자동 빌드 검증
- ✅ `kepco-poc-worker` Service 배포 (asia-northeast3)
- ✅ **KEPCO 통과 검증 완료** — `/check` 엔드포인트 호출 결과:
  - HTTP 200 OK
  - 시/도 17개 정상 수신
  - verdict=PASS
  - **차단 X 확인** ⭐
- ✅ ingress=internal 보안 복구

## ⚠️ Phase 1+ 보류 — 비용 재계산 결과 합의 초과

**실측 단가 기반 재계산 (asia-northeast3 Tier 2):**
- 5컨테이너 × 0.25 vCPU + 256MB × 24/7 = **월 약 $75**
- 의뢰자 합의 운영비 ($40~50) 초과
- API 호출 횟수 과금 X = 컨테이너 실행 시간만 청구 (간헐 운영이면 절감 가능, 5일 연속 = 풀가동)

**절감 옵션:**
- 도쿄 region (Tier 1) → 20% 절감 → 월 $60
- 사양 최소화 (0.08 vCPU + 128MB) → 월 $25
- 둘 다 → **월 $20~25** (합의 가능)

## 🔄 임시 조치 (2026-05-10~)

- GitHub Actions **임시 복귀** (워크플로 4개 복원, sunlap2026 저장소)
- Cloud Run vs Vultr vs 사양 최소화 Cloud Run 결정 보류
- 며칠~1~2주 시간 벌기 목적, sunlap2026 정지 위험 감수

## 🎯 최종 후보 비교 (의뢰자 결정 필요)

| 옵션 | 월 비용 | 장점 | 단점 |
|---|---|---|---|
| Cloud Run (서울 + 사양 최소화) | $25 | 검증 완료, 자동 배포 | latency 좋음 |
| Cloud Run (도쿄 + 사양 최소화) | $20 | 가장 저렴 | latency +20ms |
| Vultr 5대 (도쿄/서울) | $25 | IP 5개 자연 분리 | 직접 셋업 |
| NCP Micro 5대 | $72~100 | 한국 region | 비싸고 합의 초과 |
| GitHub Actions 유지 | $0 | 무료 | 정지 위험 |

→ **유력**: Cloud Run 도쿄 + 사양 최소화 ($20) 또는 Vultr ($25)

## ⚠️ OR-CBAT-23 사고 복기 (가입 단계)
- 가입 단계 결제 등록 시 OR-CBAT-23 에러 반복 (3회)
- 실제로는 백엔드에서 결제 등록 정상 처리됨 (UI 오류만 표시)
- 진단 방법: `console.cloud.google.com/billing/linkedaccount?project=<PROJECT>` 접속 후 "₩442,654 크레딧" 배너 확인
- 같은 카드로 3회 이상 시도 금지 (Google 사기 방지 시스템 강한 차단 위험)

## ⚠️ Cloud Run Service 한도 사고 복기
- Service = HTTP 요청 응답형, **request timeout 60분 한도** (5일 작업 불가)
- Worker Pool 또는 Jobs 가 본 운영용 (메모리에 적힌 채택안)
- PoC 는 Service 로 검증해도 OK (KEPCO 차단 여부만 확인 목적)
- **Phase 1 본 운영 시 Worker Pool 또는 Jobs 로 전환 필요**

## ⚠️ Cloud Run "Service URL ≠ 콘솔 표시 URL" 사고 복기
- 콘솔: `https://kepco-poc-worker-185217450716.asia-northeast3.run.app`
- 실제: `https://kepco-poc-worker-xbdifx6a6a-du.a.run.app` (gcloud describe 로 확인)
- 콘솔 URL 로 호출 → 다른 호스트의 404 HTML
- 진단: `gcloud run services describe ... --format=yaml | grep urls`

# 🔗 관련 메모

- [GitHub 이전 + 정지 이력](reference_github_migration.md) — 이전 사고 맥락
- [3차 개발 7항목](project_phase3_proposal.md) — 17개 시도 / 필지 수집기는 3차 견적 대상
