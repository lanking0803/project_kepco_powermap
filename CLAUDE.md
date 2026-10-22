# 프로젝트 지침 (Claude 협업용)

이 파일은 Claude Code 와 협업할 때 참고하는 프로젝트 전체 지침입니다.

---

## 📚 메모리 (가장 중요)

### 위치
- **`.claude/memory/`** 폴더에 모든 메모리 파일 보관
- git 으로 함께 관리되어 컴퓨터를 바꿔도 `git clone` 으로 복원 가능
- 인덱스: [.claude/memory/MEMORY.md](.claude/memory/MEMORY.md)

### 작성/사용 규칙

**Claude 가 메모리를 다룰 때 지켜야 할 규칙:**

1. **메모리 추가/수정 시 반드시 `.claude/memory/` 안에서만 작업**
   - `~/.claude/projects/.../memory/` 등 사용자 홈의 자동 메모리 시스템은 사용하지 않음
   - 모든 메모리는 프로젝트 안에서 git 으로 관리됨

2. **새 메모리 파일을 만들 때**
   - `.claude/memory/{type}_{topic}.md` 형식 (예: `project_solar_proposal.md`, `feedback_mobile_principles.md`)
   - 파일 상단에 frontmatter (name, description, type) 포함
   - [.claude/memory/MEMORY.md](.claude/memory/MEMORY.md) 인덱스에 한 줄 추가

3. **타입 분류**
   - `user_*` — 사용자 정보, 역할, 선호
   - `feedback_*` — 작업 방식 피드백/원칙
   - `project_*` — 차기 개발 계획, 진행 중인 작업 컨텍스트
   - `reference_*` — 외부 시스템 참조 정보
   - `kepco_*`, `geocode_*` — 도메인별 규칙

4. **새 대화 시작 시**
   - Claude 는 첫 응답 전에 [.claude/memory/MEMORY.md](.claude/memory/MEMORY.md) 를 읽어 컨텍스트를 파악할 것
   - 관련 메모리 파일은 필요할 때 읽음

5. **금지 사항**
   - 코드/git log 로 알 수 있는 정보를 메모리에 중복 기록 금지
   - 이미 완료된 작업의 진행 기록 금지 (commit message 가 진실)
   - 메모리는 "코드만 봐선 알 수 없는 맥락/이유" 만 기록

---

## 🔐 자격증명 / 비밀

- **원천은 볼트다** — `project_second_brain/01_Projects/project_kepco_powermap/_자격증명.local.md`
- [docs/SECRETS.local.md](docs/SECRETS.local.md) 는 2026-09-06 부터 **포인터 stub** 이다 (값 없음).
  기존 참조 18곳을 살리려고 파일 자체는 남겼다
- `.gitignore` 에 `*.local.md` 패턴 등록되어 git 에 올라가지 않음
- 외부 공유 / 채팅 / 스크린샷 금지

---

## 📁 프로젝트 구조

```
project_kepco_powermap/
├── .claude/
│   └── memory/        ← Claude 협업용 메모리 (이 파일과 함께 관리)
├── crawler/           ← Python 크롤러 (KEPCO API)
├── data/              ← 데이터 파일 (.gitignore)
├── db/                ← Supabase 마이그레이션
├── docs/              ← 프로젝트 문서
│   ├── 개발계획.md     ← 통합 개발 계획서 (메인)
│   ├── PLAN.md
│   ├── COMPARE.md
│   ├── CRAWLING.md
│   ├── SERVICES.md
│   └── SECRETS.local.md  ← 포인터 stub. 값은 볼트에 (git 제외)
├── geocoder/          ← 지오코딩 워커
├── web/               ← Next.js + React 웹 서비스
│   ├── CLAUDE.md      ← Next.js 특수 지침
│   └── ...
└── CLAUDE.md          ← 이 파일 (전체 지침)
```

---

## 📖 핵심 문서 인덱스

작업 시작 전 반드시 읽어볼 것:

- [docs/개발계획.md](docs/개발계획.md) — Phase 1~5 진행 내역, 차기 개발, **§4-1 개발 교훈**
- [docs/PLAN.md](docs/PLAN.md) — 초기 설계, 양식 검증, 결정 사항
- [docs/COMPARE.md](docs/COMPARE.md) — 변화 추적 설계
- [docs/CRAWLING.md](docs/CRAWLING.md) — 크롤링 아키텍처
- [docs/SERVICES.md](docs/SERVICES.md) — 외부 서비스 키/콘솔/한도
- [.claude/memory/MEMORY.md](.claude/memory/MEMORY.md) — 메모리 인덱스

---

## 🎯 협업 원칙 (요약)

자세한 내용은 메모리의 `feedback_*.md` 파일들 참고:

- **코드 수정 전 반드시 해당 파일 Read 먼저**
- **승인 기준은 전역 `~/.claude/CLAUDE.md` § 승인 을 따른다** (이 프로젝트만의 예외 없음)
  - 단, **푸시는 성능 테스트 통과 후** — `memory/feedback_push_after_perf_test.md`
- **커밋은 명시적 요청 시에만**
- **기존 프로젝트 패턴/컨벤션 준수**
- **한국어로 응답**
- **모바일 4대 원칙 준수** (memory/feedback_mobile_principles.md 참고)
- **덕지덕지 패치 금지** — 근본 원인 찾기

---

## 📝 변경 이력

- 2026-04-16: 메모리를 `~/.claude/projects/...` 에서 `.claude/memory/` 로 통합 이전
- 2026-04-16: CLAUDE.md 신설 (전체 협업 지침)
