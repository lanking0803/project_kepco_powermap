# 외부 서비스 통합 문서

이 문서는 프로젝트가 사용하는 모든 외부 서비스의 메타 정보를 한곳에 모아두는 곳입니다.
**실제 키 / 비밀번호는 [SECRETS.local.md](SECRETS.local.md)** 에 보관합니다 (gitignored).

---

## 한눈에 보기

| 서비스 | 용도 | 무료? | 한도 | 만료일 | 비고 |
|---|---|---|---|---|---|
| **Kakao Developers** | 지도 표시, 지오코딩 (메인) | ✅ | 300,000건/일 | - | 빠름, 정확 |
| **VWorld** | 지오코딩 (fallback) | ✅ | 사실상 무제한 | **2028-10-08** | 공공기관, 운영 승인 완료 (2026-04-29) |
| **Vercel** | 호스팅 | ✅ Hobby | 100GB 대역폭/월 | - | 미배포 |
| **Supabase** | DB / Auth / 캐시 | ✅ | 500MB DB / 5GB egress | - | `kepco-web-map` (Seoul) |

---

## 1. Kakao Developers

### 개요
- 카카오맵 JavaScript SDK + REST API 제공
- 한국 내 가장 빠르고 정확한 지오코딩
- 프로젝트의 **메인 지오코딩 + 지도 SDK**

### 콘솔
- URL: https://developers.kakao.com/console/app/1424714
- 앱 이름: `kepco_web`
- 앱 ID: `1424714`

### 사용 중인 기능
| 기능 | 키 종류 | 사용 위치 |
|---|---|---|
| 지도 SDK + 클러스터러 | JavaScript 키 | [components/KakaoMap.tsx](../web/components/KakaoMap.tsx) |
| 주소 → 좌표 변환 | REST API 키 | [app/api/geocode/route.ts](../web/app/api/geocode/route.ts) |
| 지도 검색(주소 이동) | JavaScript 키 | [app/page.tsx](../web/app/page.tsx) `handleSearch` |

### 무료 한도
| API | 한도 | 초과 시 | 비고 |
|---|---|---|---|
| 지도 JavaScript SDK | 무제한 | - | 마커, 클러스터링 포함 |
| 지오코딩 (주소→좌표) | 300,000건/일 | 차단 (과금 없음) | REST API |
| 역지오코딩 (좌표→주소) | 300,000건/일 | 차단 (과금 없음) | REST API |

### 등록된 플랫폼 (Web)
- `http://localhost:3000` (개발)
- `https://kepco-powermap.vercel.app` (운영)

### 환경변수
```
NEXT_PUBLIC_KAKAO_JS_KEY  # JavaScript 키 (브라우저 노출 OK)
KAKAO_REST_KEY            # REST API 키 (서버 전용)
```

### 주의사항
- JavaScript 키는 브라우저에 노출되지만, **카카오 개발자 콘솔의 도메인 화이트리스트로 보호**됨
- REST API 키는 절대 브라우저에 노출 금지 → API Route 통해서만 호출
- 일 한도 초과 시 자동 차단 (과금 X), 자정 지나면 복구

---

## 2. VWorld (국토교통부 공간정보 오픈플랫폼)

### 개요
- 국토교통부에서 운영하는 공공 지도/주소 API
- **완전 무료**, 사실상 무제한
- 카카오 한도 초과 시 fallback으로 사용

### 콘솔
- URL: https://www.vworld.kr/dev/v4api.do
- 메인: https://www.vworld.kr

### 사용 중인 기능
| 기능 | 사용 위치 | 비고 |
|---|---|---|
| 검색 API (지오코딩) | [app/api/geocode/route.ts](../web/app/api/geocode/route.ts) | Kakao fallback |

### 무료 한도
- **공식**: 무제한
- **실질**: 분당/초당 트래픽 제한 있음 (일반 사용 시 문제 없음)
- **권장 병렬도**: 3~5개 동시 호출

### 키 정보
- **인증키 상태**: ✅ **운영 승인 완료** (2026-04-29) — 사용기관 (주)한국에텍
- **인증키 만료일**: **2028-10-08** ⚠️ 만료 1개월 전 콘솔 연장 신청
- **등록 서비스 URL**: `https://sunlap.kr`, `https://www.sunlap.kr`
- **활성화 API**: WMS/WFS API + 검색 API + 2D 데이터 API + 지오코더 API + 2D/3D 지도 API + 배경지도 API + WMTS/TMS API
  - 코드 실 사용은 `WMS/WFS API` + `검색 API` 2종이 핵심
- **갱신 방법**: 만료 전 콘솔에서 연장 신청 (운영 키는 2년 연장 가능)

### 환경변수
```
VWORLD_KEY  # 인증키 (서버 전용)
```

### 주의사항
- **Referer 헤더 검증**: 등록한 URL에서 호출되는 요청만 허용
- 브라우저 직접 호출 시 CORS 막힘 → API Route 경유 필수
- "기타지역" 같은 비표준 주소는 카카오와 마찬가지로 실패 가능

### 응답 포맷 (참고)
```json
{
  "response": {
    "status": "OK",
    "result": {
      "point": { "x": "127.123456", "y": "34.567890" }
    }
  }
}
```

---

## 3. Vercel

### 개요
- Next.js 호스팅 플랫폼
- Edge Functions, KV, Postgres 등 통합 제공
- **플랜**: Hobby (무료)

### 계정
- **가입 방법**: Google 소셜 로그인
- **계정**: `hicor150010@gmail.com`
- **콘솔**: https://vercel.com/dashboard

### 프로젝트 설정
- **프로젝트명**: `kepco-powermap`
- **GitHub 연결**: `hicor1/project_kepco_powermap`
- **Root Directory**: `web`
- **Framework**: Next.js (자동 감지)
- **배포 도메인**: `https://kepco-powermap.vercel.app`

### 환경변수 (Vercel에 등록)
| 변수 | 용도 | 비고 |
|---|---|---|
| `NEXT_PUBLIC_KAKAO_JS_KEY` | 카카오 지도 SDK | 브라우저 노출 OK |
| `KAKAO_REST_KEY` | 카카오 지오코딩 | 서버 전용 |
| `VWORLD_KEY` | VWorld 지오코딩 | 서버 전용 |
| `GITHUB_PAT` | 크롤링 트리거 | 서버 전용 |
| `GITHUB_REPO` | 리포 경로 | `hicor1/project_kepco_powermap` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API | 브라우저 노출 OK |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 익명키 | 브라우저 노출 OK |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 관리키 | 서버 전용 |

### 무료 한도 (Hobby)
| 항목 | 한도 | 비고 |
|---|---|---|
| 대역폭 | 100 GB/월 | |
| 빌드 시간 | 6,000분/월 | |
| Edge Function 실행 | 500,000회/월 | |
| Vercel KV (Upstash) | 256 MB / 10K 명령/일 | 미사용 |

### 배포 완료 (2026-04-10)
1. ~~GitHub 리포지토리 연결~~ ✅
2. ~~환경변수 등록~~ ✅
3. ~~Kakao 콘솔에 배포 도메인 추가~~ ✅
4. ~~VWorld — 서비스URL `*` (와일드카드) 설정으로 별도 추가 불필요~~ ✅
5. ~~이 문서에 프로젝트명 + 배포 도메인 기입~~ ✅

---

## 4. Supabase

### 개요
- Postgres + Auth + Storage + Edge Functions
- **프로젝트**: `kepco-web-map` (Seoul region)
- **Project ID**: `wtbwgjejfrrwgbzgcdjd`
- **콘솔**: https://supabase.com/dashboard/project/wtbwgjejfrrwgbzgcdjd
- KEPCO 데이터 + 지오코딩 캐시 + 사용자 인증 통합 저장소

### 무료 한도
| 항목 | 한도 | 비고 |
|---|---|---|
| DB 용량 | 500 MB | 핵심 |
| 월 egress | 5 GB | 다운로드 양 |
| API 요청 | 무제한 | |
| MAU | 50,000 | |
| **휴면** | 7일 미접속 시 일시정지 | ⚠️ |

### DB 구조
- `kepco_addr` — 주소 마스터 (시도/시/구/동/리/지번)
- `kepco_capa` — 용량 데이터 (addr_id FK, 시설명, kW 수치)
- `kepco_map_summary` — 지도 마커용 MV (리 단위 집계)
- ~~`kepco_capa_ref`~~, ~~`kepco_capa_changelog`~~ — **2026-04-22 폐기** (ref/changelog 기반 비교 시스템 제거, 테이블/RPC 수동 DROP 대기. [COMPARE.md](./COMPARE.md))
- ~~`geocode_cache`~~ — **2026-04-22 폐기** (좌표는 `kepco_addr.lat/lng` 단일 저장, 지번은 KV on-demand. 수동 DROP 대기: `db/migrations/026_drop_geocode_cache.sql`)
- `crawl_jobs` — 크롤링 작업 관리
- `user_roles` — 사용자 권한

### API 캐시 전략 (2026-04-11)
- **대상**: `/api/map-summary`, `/api/location`
- **방식**: `Cache-Control: public, s-maxage=3600, stale-while-revalidate=60`
  - Vercel CDN 엣지에서 1시간 캐시 → Supabase 호출 최소화
  - `stale-while-revalidate=60`: 만료 직후 60초간 stale 응답 반환하며 백그라운드 갱신
- **새로고침**: 사이드바 상단 새로고침 버튼 → `?_t=timestamp` + `cache: no-store`로 CDN 캐시 우회
- **캐시하지 않는 것**: `/api/search` (사용자 입력 기반, 반복 적음), `/api/geocode` (이미 KV+DB 3단계 캐시)

### DB 최적화 이력 (2026-04-11)
- **불필요 인덱스 8개 제거**: trigram GIN 3개, btree 5개 (사용횟수 0)
- **UPSERT unique 해시화**: 9컬럼 텍스트 unique → `row_hash` (MD5 32자) unique
  - UPSERT 시 `on_conflict=row_hash` 사용
  - 트리거(`trg_row_hash`)가 INSERT/UPDATE 시 자동 계산
- **결과**: DB 110MB → 53MB (52% 감소)
- **전국 추정**: ~320MB (500MB 한도 이내)
- **원복 SQL**: `db/migrations/012_row_hash.sql` 상단 주석 참고

### 생성 시 필요 작업
1. supabase.com 회원가입
2. 새 프로젝트 생성 (region: Northeast Asia - Seoul 권장)
3. DB 패스워드 설정 → SECRETS.local.md 기록
4. 환경변수 발급:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (서버 전용)
5. 휴면 방지 cron 설정 (주 1회 ping)

---

## 5. GitHub Actions

### 개요
- KEPCO 크롤링 자동 실행 플랫폼
- 3개 독립 스레드 동시 실행 가능
- 아키텍처 상세: [CRAWLING.md](CRAWLING.md) 참고

### 리포지토리
- URL: https://github.com/hicor1/project_kepco_powermap
- Visibility: **Public** (Actions 무제한 무료)

### 워크플로우
| 이름 | 파일 | 용도 |
|------|------|------|
| KEPCO Crawl | `.github/workflows/crawl.yml` | 크롤링 (스레드 1/2/3) |
| KEPCO Geocode | `.github/workflows/geocode.yml` | 지오코딩 (레거시, 크롤러에 통합됨) |

### 무료 한도
| 항목 | 한도 | 비고 |
|------|------|------|
| 동시 Job | 20개 | 계정 기준 (3개 사용) |
| 실행 시간 | 무제한 | Public repo |
| Job당 최대 | 6시간 | 3시간 체이닝으로 해결 |
| 스토리지 | 500 MB | Artifacts/Cache |

### GitHub Secrets
| 시크릿 | 용도 | 비고 |
|--------|------|------|
| `SUPABASE_URL` | Supabase API URL | |
| `SUPABASE_SERVICE_KEY` | Supabase service role 키 | |
| `KAKAO_REST_KEY` | 카카오 지오코딩 | |
| `GH_PAT` | Actions 자동 트리거 | **workflow 스코프 필수** |

### 주의사항
- `GH_PAT`에 **workflow 스코프**가 있어야 crawl.yml 푸시 + dispatch 가능
- PAT 생성: GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens
- concurrency group이 스레드별로 분리되어 동시 실행 안전

---

## 6. KEPCO API (크롤링 대상)

### 개요
- 한국전력공사 배전선로 여유용량 조회 시스템
- 비공식 API (웹 사이트 내부 API 역호출)
- **공식 API 제공 없음** — 차단 위험 있음

### 엔드포인트
- Base URL: `https://online.kepco.co.kr`
- 주소 조회: `/EWM092D00SJ.do` (POST, JSON)

### 차단 방지 대책
| 대책 | 설명 |
|------|------|
| User-Agent 랜덤 | 7개 브라우저 UA 풀 |
| 세션 재생성 | 2,000건마다 새 세션 |
| 주기적 휴식 | 1,000건마다 30초 대기 |
| 점진적 백오프 | 연속 에러 시 60~180초 대기 |
| delay 조정 | 0.15초~2.0초 (UI에서 설정) |

### 주의사항
- 동시 3개 스레드 시 delay를 0.5초 이상 권장
- 연속 10회 에러 시 자동 중단 (TooManyErrorsException)
- IP 차단 시 GitHub Actions 러너 IP 변경으로 자연 해제 (재실행)

---

## 부록 A — 자격증명 관리 원칙

### 1. 분리 원칙
- **공개 가능한 정보** → `SERVICES.md` (이 파일, git tracked)
- **비밀 정보** → `SECRETS.local.md` (gitignored)
- 새 서비스 추가 시: SERVICES.md 먼저 → SECRETS.local.md에 키 추가

### 2. .gitignore 확인
`docs/.gitignore`에 다음이 등록되어 있어야 함:
```
SECRETS.local.md
*.local.md
*.secret.md
```

### 3. 만료 관리
- 키 발급 시 **만료일을 SERVICES.md 표 + SECRETS.local.md**에 기록
- 만료 1개월 전 알림 권장

### 4. 키 노출 시 대응
1. 즉시 해당 서비스 콘솔에서 키 폐기/재발급
2. SECRETS.local.md 갱신
3. `.env.local` 갱신
4. Vercel 환경변수 갱신 (배포 중이라면)

### 5. 유출 사고 (참고)
- 2026-04-08: 초기 `API_KEYS.md`가 git에 commit되어 카카오 키가 히스토리에 남음
  → private repo이므로 외부 노출 없으나, 이후 SECRETS.local.md로 분리 관리
  → 카카오 키 폐기/재발급 검토 필요 (선택)

---

## 부록 B — 서비스별 콘솔 빠른 링크

| 서비스 | 콘솔 URL |
|---|---|
| Kakao | https://developers.kakao.com/console/app/1424714 |
| VWorld | https://www.vworld.kr/dev/v4api.do |
| Vercel | https://vercel.com/dashboard |
| Supabase | https://supabase.com/dashboard/project/wtbwgjejfrrwgbzgcdjd |

---

## 변경 이력
- 2026-04-22: 비교 기능 리팩토링 — ref/changelog 테이블·RPC 사용 중단 (수동 DROP 예정). 신규 방식은 엑셀 업로드 기반
- 2026-04-12: DB 구조 갱신 — kepco_addr/capa 분리, ref+changelog 추가, history 삭제 (ref/changelog 은 2026-04-22 폐기)
- 2026-04-11: API 캐시 — map-summary, location에 CDN 캐시 1시간 + 새로고침 버튼 추가
- 2026-04-11: DB 최적화 — 불필요 인덱스 8개 제거 + UPSERT unique 해시화 (110MB → 53MB)
- 2026-04-10: Vercel 배포 완료. 계정/프로젝트/도메인 정보 추가. VWorld 서비스URL 와일드카드 확인.
- 2026-04-08: 초안 작성. 기존 API_KEYS.md를 SERVICES.md(공개) + SECRETS.local.md(비공개)로 분리. VWorld 추가.
