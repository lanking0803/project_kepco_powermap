---
name: 건축물대장 API (건축HUB) — 검증 완료
description: 2차 개발 핵심 데이터 소스. 키·endpoint·필드 모두 실측 OK. 상세는 docs/api_건축물대장.md
type: reference
---

> **상세 호출 스펙 / 필수 파라미터 / 응답 필드 / 트러블슈팅** → [docs/api_건축물대장.md](../../docs/api_건축물대장.md)
> 이 메모는 **요점 + 한계** 만 담음.

## 📌 검증 결과 (2026-04-16)

- **API 정상 작동 확인**. 2차 개발(유리온실/축사/일반건물 + 평수 필터)에 그대로 사용 가능.
- **End Point**: `https://apis.data.go.kr/1613000/BldRgstHubService`
- **메인 오퍼레이션**: `getBrTitleInfo` (표제부) + `getBrRecapTitleInfo` (총괄표제부)
- **트래픽**: 10,000건/일 (개발계정, 무료, 자동승인)
- **인증키**: `docs/SECRETS.local.md` 의 "공공데이터포털 — 건축HUB"

## ⚠️ 결정적 한계

- **비닐하우스/간이 슬레이트 축사는 가설건축물이라 미등록** → 거의 안 잡힘
- 의뢰자에게 정직하게 안내함. 대안: 농림부 통계(시군구 합계만), 위성영상 AI(별도 프로젝트)
- 유리온실(특히 100평↑), 축사(콘크리트/철골), 공장/창고/일반건물은 ✅ 등록됨

## 🚨 호출 모드 2종 (2026-05-03 추가)

### 1. 단건 (PNU → 그 지번 위 건물 N개)
- 1차 견적용. `lib/building-hub/title.ts` / `/api/buildings/by-pnu`
- 입력: sigunguCd + bjdongCd + platGbCd + bun + ji **모두 필수**

### 2. 일괄 (법정동 → 그 동 모든 건물) — 시설 모드용
- `lib/building-hub/list.ts` / `/api/buildings/list/by-bjd`
- 입력: sigunguCd + bjdongCd 만 (bun/ji 생략)
- **검증 (2026-05-03)**: 강남 역삼동 totalCount=4,957 / 구례읍 267 / 마산면 0
- ⚠️ **`numOfRows` 100 hard cap** — 요청 500/1000 보내도 무시, 무조건 100건만 응답
- 페이지 순회 필수 (`pageNo` 증분)
- bjdongCd 빈값/생략 = totalCount=0 (시군구만으론 조회 불가)

## 🔑 시설 모드 매칭 코드 (실측 표기 주의)

| 코드 | mainPurpsCdNm 실측 | 시설 모드 매핑 |
|---|---|---|
| `21000` | **"동물및식물관련시설"** ⚠️ | 유리온실/축사 (etcPurps 로 세분) |
| `17000` | "공장" | 시설 모드 |
| `18000` | "창고시설" | 시설 모드 |

⚠️ **한글명은 "동·식물관련시설" (가운데점) 이 아니라 "동물및식물관련시설"** (구례읍 실측 2026-05-03). **`mainPurpsCd === "21000"` 코드 매칭 필수**, 한글명 매칭은 변동 위험.

지붕코드 `roofCd === "41"` = 유리 (유리온실 식별 보조).

## 🔑 트러블슈팅 핵심

- **401 Unauthorized 의 진짜 원인**: 키 문제가 아니라 **존재하지 않는 시군구/법정동 조합** 일 때 게이트웨이가 401 반환
- → 의심되는 주소 시도 전, 검증된 주소(예: 서울 강남 삼성동 159)로 200 OK 먼저 확인할 것

## 🧪 테스트 스크립트

[scripts/test_bldg_api/test_brtitle.mjs](../../scripts/test_bldg_api/test_brtitle.mjs) — Node 22+ 에서 실행
