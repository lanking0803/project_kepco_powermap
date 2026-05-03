---
name: 공매에 읍·면·동 dropdown 추가 — 미완료 과제
description: /api/regions/eupmyeondong 을 공매 검색 패널에도 적용 (선택값, "전체" 옵션 포함). 시설 모드 작업과 병렬 또는 후행 가능.
type: project
---

# 공매 — 읍·면·동 dropdown 추가 (2026-05-03 등록)

## 배경
2026-05-03 시설 모드 위해 `/api/regions/eupmyeondong` atomic endpoint 신설.
**시설 모드는 동까지 필수**(외부 건축HUB API 강제), **공매는 선택**.
의뢰자 합의: "어차피 받아온다면 공매쪽에도 드롭다운으로 같이 적용하는게 이득".

## 작업 내용
- 공매 검색 패널(`OnbidSearchPanel.tsx`)에 읍·면·동 dropdown 추가
- **첫 옵션 = "전체" (선택)** — 시설 모드와 다르게 미선택 = 시군구 전체 검색
- 시군구 변경 시 읍·면·동 dropdown 재조회 (`fetchEupmyeondongs(sigunguCode)`)
- 동 선택 시 캠코 OnbidRlstListSrvc2 의 어느 파라미터로 보낼지 검증 필요
  - 공매 API 가 동 단위 필터를 지원하는지 실 호출 검증
  - 미지원이면 클라이언트 후처리 (응답 매물의 PNU 앞 10자리 == 선택 동 코드)

## 시설 모드와의 차이점

| 항목 | 시설 | 공매 |
|---|---|---|
| 동 선택 | 필수 | 선택 |
| 첫 옵션 | (placeholder 만, 선택 강제) | "전체" |
| 미선택 시 | 검색 버튼 disabled | 시군구 전체 검색 |
| API 호출 키 | bjd_code 10자리 | sigungu_code 5자리 (동 미선택) 또는 bjd_code 10자리 |

## 경매도 동일 패턴 권장
경매 검색 패널도 같은 패턴(선택 + "전체") 으로 추가 가능. 공매 작업과 묶어 처리.

## How to apply
시설 모드 본 작업 완료 후, 또는 병렬로 처리. 시설 모드 작업 사고 발생 시 우선순위 낮춤.
