---
name: 법제처 OPEN API 도메인 검증 — Referer/Origin 헤더 필수
description: 법제처 자치법규 검색 API 는 등록 도메인을 Referer/Origin 헤더로 검증. 서버사이드 fetch 는 헤더 미부착 → "사용자 정보 검증 실패". 한글 헤더 값은 fetch 가 거부.
type: reference
---

## 핵심
- 법제처 OPEN API (`law.go.kr/DRF/lawSearch.do`, `lawService.do`) 는 IP **또는** 도메인 등록제.
- IP 등록은 본인 PC 만 가능 (Vercel IP 풀 동적). → **도메인 등록 + Referer/Origin 헤더 부착** 이 정답.
- 등록 도메인 (예: `sunlap.kr`) 을 `Referer` `Origin` 양쪽에 명시해야 통과.

## 함정 1 — 서버사이드 fetch 는 도메인 헤더가 자동으로 안 붙는다
- 브라우저 fetch 는 자동으로 `Referer` 부착 → 본인 PC 에선 정상 동작
- Vercel 서버사이드 fetch 는 Referer/Origin 없음 → silent fail (`<result>사용자 정보 검증에 실패하였습니다.</result>` 평문 반환)
- 응답 코드는 200 → 코드가 정상 처리로 오인. 본문 프리뷰 로깅 필수.

## 함정 2 — 헤더 값에 한글 쓰면 Node fetch 가 거부
- `User-Agent: "sunlap.kr 견적 모드"` 같이 한글 넣으면
- `TypeError: Cannot convert argument to a ByteString because the character at index N has a value of XXXXX which is greater than 255.`
- Node fetch 는 헤더 값을 ASCII(ByteString) 로만 허용. **모든 헤더 값은 ASCII** 로.

## 위치
- 호출 코드: [`web/lib/regulations/law-api.ts`](../../web/lib/regulations/law-api.ts) `searchOrdinancesByQuery()`
- 등록 콘솔: https://open.law.go.kr → 마이페이지 → OPEN API 신청내역
- 등록 도메인: `sunlap.kr` (2026-04-30 등록 완료)

## 신규 한국 외부 API 추가 시 체크리스트
1. region = icn1 ([reference_vercel_region.md](reference_vercel_region.md))
2. 도메인 등록제 API 면 Referer + Origin 헤더 명시 부착
3. 헤더 값은 ASCII 만
4. 응답 본문 프리뷰 로깅 (200 OK 사일런트 거부 케이스)