---
name: 비슷한 endpoint 신규 작성 시 기존 패턴 미러 우선
description: 새 채널/소스용 by-pnu/search/detail 등 endpoint 신규 작성 시 기존에 잘 작동하는 같은 류(공매, hyphen, kepco) 패턴부터 보고 그대로 미러. 자체 로직으로 짜다 동명이리/누락 등 함정에 빠짐.
type: feedback
---

# 원칙

새 채널/데이터소스의 endpoint 를 짤 때, **기존 비슷한 endpoint 의 흐름·로직을 먼저 미러**한다. 특히:
- by-pnu (PNU 기반 매물 조회)
- search (지역 단위 검색)
- detail (단건 상세)
- enrich/adapter (raw → SSOT 변환)

자체 로직으로 짜기 전에 **이미 운영되고 있는 동일 패턴 1개를 끝까지 읽고 따라간다**.

# Why

**2026-05-04 court 채널 by-pnu 사례** (수 시간 낭비):

court by-pnu 작성 시 onbid by-pnu 의 검증된 패턴을 무시:
- 공매(`web/app/api/onbid/by-pnu/route.ts`): **PNU[0:10] → bjd_master 정방향 1번 조회** → sep_1~5 받아 그대로 캠코 입력
- 새로 짠 court: 매물 한글주소 → bjd_master **역조회** (sep_4=화장동 매칭)

→ **방향이 반대**라 동명이리(광주 화장동 vs 여수 화장동) 충돌 발생. 사용자 클릭 매물의 PNU 가 잘못된 BJD 로 박힘 → fallback 폭발.

의뢰자 한 줄: "공매도 쓰고있을텐데 공매거 참고를 안한거냐". 5분 안에 답이 나왔어야 할 사안.

# How to apply

**새 endpoint 작성 직전 체크리스트**:
1. "같은 역할의 기존 endpoint 가 있나?" — 도메인이 다른 채널(공매↔경매)이라도 흐름은 같음
2. 그 endpoint 코드를 **처음부터 끝까지 읽고** 자기 머리로 흐름 그려보기
3. 차이점이 있으면 그 차이가 **반드시 필요한지** 명시 (외부 API 시그니처 차이 등)
4. 차이가 없으면 미러 — 변수명/주석까지 일관성 유지

**금지**:
- 자체 로직으로 짜놓고 "공매도 비슷한 패턴이 있겠지" 추정만
- 외부 API 의 코드 필드 무시하고 한글로 우회 매칭 (raw 에 `srchHjguDongCd` 8자리 박혀 있는데 hjguDong 한글로 매칭한 케이스)

**연관 메모**:
- [feedback_reuse_existing_assets.md](feedback_reuse_existing_assets.md) — DB 자산 재활용
- [project_court_auction_direct.md](project_court_auction_direct.md) — court swap 작업 자체 기록