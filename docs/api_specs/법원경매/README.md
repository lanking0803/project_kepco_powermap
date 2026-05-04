# 법원경매 사이트 API 응답 캡처

courtauction.go.kr 사이트의 카테고리 트리(대/중/소 분류) 응답 캡처.
2026-05-05 의뢰자 직접 캡처. court 채널 카테고리 시스템 검증 근거.

## 파일

- `usgMcl_토지.json` — 토지 대분류의 중분류 목록
- `usgMcl_건물.json` — 건물 대분류의 중분류 목록
- `usgScl_토지_지목.json` — 토지/지목 소분류 28개
- `usgScl_건물_주거용.json` — 건물/주거용건물 소분류 11개
- `usgScl_건물_상업용.json` — 건물/상업용및업무용 소분류 18개
- `usgScl_건물_산업용.json` — 건물/산업용및기타특수용 소분류 6개
- `usgScl_건물_복합용.json` — 건물/용도복합용 소분류 3개

## 활용

`web/lib/court-auction/categories.ts` 의 분류 트리 데이터 출처.
다음에 매핑 의심될 때 이 폴더 비교.
