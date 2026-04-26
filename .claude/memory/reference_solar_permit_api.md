---
name: 태양광 허가 API (전국태양광발전소전기사업허가정보표준데이터) — 검증 결과
description: data.go.kr/15107742. 명세 PDF 와 달리 검색 필터 전부 미지원. 페이지네이션만 가능. Phase 3 정식 작업 시 DB 적재 + by-pnu 신설 필요.
type: reference
---

> **wrapper / atomic endpoint**: [web/lib/solar-permit/by-page.ts](../../web/lib/solar-permit/by-page.ts) · [web/app/api/solar-permits/by-page/route.ts](../../web/app/api/solar-permits/by-page/route.ts)
> **service 메타** (관리자 콘솔): [web/app/admin/api-manager/_lib/services/solar-permit.ts](../../web/app/admin/api-manager/_lib/services/solar-permit.ts)
> **명세 PDF**: [docs/api_specs/태양광허가정보/](../../docs/api_specs/태양광허가정보/)

## 📌 검증 결과 (2026-04-26 직접 호출)

### 1. 검색 필터 전부 미지원 — 명세 PDF 와 다름

명세 PDF 의 "Request Parameter" 표는 **응답 필드 명세**일 뿐, 실제 필터로 작동 안 함:

| 시도 | 결과 |
|---|---|
| `LCTN_LOTNO_ADDR=경기도 파주시 조리읍 대원리 1245` | NODATA |
| `LCTN_LOTNO_ADDR=경상북도 성주군` (페이지 1에 202건 있는 지역) | NODATA |
| `LCTN_LOTNO_ADDR=전북특별자치도 임실군 임실읍 감성리 198-12` (응답 정확값) | NODATA |
| `LCTN_ROAD_NM_ADDR` (도로명, 응답 정확값) | NODATA |
| `SOLAR_GEN_FCLT_NM=용신태양광발전소` (시설명, 응답 정확값) | NODATA |
| `LATITUDE=35.60051085` (응답 정확값) | ✅ OK |
| `LATITUDE=35.6005` (한 자리 잘라냄) | NODATA |
| `소재지지번주소=...` (한글 파라미터명) | INVALID_REQUEST_PARAMETER_ERROR |

→ **결론: pageNo + numOfRows + type 만 작동.** LATITUDE 는 byte 단위 정확 일치만 → 실용 0.

### 2. 응답 필드 = camelCase (명세 PDF 의 대문자와 다름)

| 명세 PDF | 실제 응답 |
|---|---|
| `LCTN_LOTNO_ADDR` | `lctnLotnoAddr` |
| `SOLAR_GEN_FCLT_NM` | `solarGenFcltNm` |
| `LATITUDE` / `LONGITUDE` | `latitude` / `longitude` |
| `CAPA` | `capa` |
| ... 17 필드 | ... |

→ wrapper 가 모두 camelCase 매핑.

### 3. 데이터 규모

- totalCount: **121,015** (전국)
- 122 페이지 × 1000건 = 전수 다운로드 가능
- 운영계정 100K/일 → 122 호출은 1분 미만 + 대역폭 미미

### 4. 데이터 분포 (페이지 표본 5개 분석)

- 등장 시도: 전북특별자치도 임실군, 경상북도 성주군, 충청북도 진천/청주, 전라남도 곡성/해남/고흥/장흥, 강원특별자치도 춘천/고성/화천/강릉, 충청남도 서천/아산
- 경기도 파주: 페이지 10에 1건, 페이지 100에 4건 (전국에 일부 존재)
- 빈 lctnLotnoAddr 행도 존재 (페이지 1에 334건 등) — 좌표만 있는 데이터

## 🎯 사용 패턴

### 본 atomic endpoint `/api/solar-permits/by-page` 의 역할

1. **API 살아있나 라이브 검증** (관리자 콘솔)
2. **Phase 3 정식 시점 수집기의 기반 코드** (그대로 재사용)

→ **사용자 영업 화면 X** — 검색 미지원이라 사용자 클릭 시점 호출 불가.

### Phase 3 정식 작업 (영업 기능 구현 시)

```
[1단계 — 수집기] GitHub Actions 월 1회 cron
   → 122 페이지 전수 다운로드 (~7분)
   → Supabase solar_permits 테이블 적재
   → PostGIS GIST 인덱스 (geom GEOGRAPHY)

[2단계 — 검색 endpoint] 사용자 PNU 클릭
   → /api/solar-permits/by-pnu (DB 검색)
   → /api/solar-permits/near-point?lat=&lng=&radius=50
   → 결과: 50m 반경 시설 (외부 호출 0, 1ms 이하)

[3단계 — UI]
   → 지번 패널에 ☀️ 배지
   → 의뢰자 의도: "이미 설치됐어도 그대로 두고 주변 물건 영업" (제외 X, 표시만)
```

견적: ① 태양광 설치여부 표시 (150만 / 3~4주) — [docs/견적_3차_데이터연계.md](../../docs/견적_3차_데이터연계.md)

## ⚠️ 데이터 한계

- **3 kW 이하 자가발전 누락** (허가 대상 아님 — 축사/온실은 30kW↑ 라 영향 적음)
- 응답 = JSON (type=json) 또는 XML (기본)
- numOfRows 최대 1,000
- 일부 sentinel 값: `instlYr=1900` (실제 미상), `lctnRoadNmAddr=""` (도로명 없는 경우)

## 💡 교훈

**API 검증 = 응답 확인 X. 실제 사용 패턴 시뮬레이션이어야 함.**
- 2026-04-17 검증에서 "API 응답함" 만 확인하고 "검색 가능 100%" 결론 → 잘못
- 2026-04-26 직접 호출로 "검색 필터 전부 미지원" 발견
- 이후 외부 API 검증 시 **실제 사용 시나리오 (PNU 단건 / 좌표 반경 등) 까지 시뮬레이션 후 결론**