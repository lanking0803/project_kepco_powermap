---
name: KEPCO 같은 마을 fallback (지번 매칭 0건 대응)
description: /api/capa/by-pnu exact 0건 시 같은 bjd_code 안 본번거리 top 5 row 표시. RPC plan trap = EXECUTE format 으로 회피. UI = LocationDetailGrouped compact 재활용.
type: project
---

## 의뢰자 의도 (2026-05-01 결정)

지번 클릭 시 한전 매칭 0건이면 "매칭 없음" 만 표시되어 영업 임팩트 0.
→ 같은 마을(bjd_code) 안 본번거리 가까운 row top 5 표시. 영업이 인근 지번 정보로 추정 가능.

## 핵심 결정

- **fallback 발동 조건**: exact 매칭 0건 시만. 정상 매칭은 추가 부담 0.
- **정렬 키**: 본번 거리 (`-`/`의` → `.`, 한글/특수문자 삭제 후 numeric).
- **산 ↔ 일반 분리 X**: 단순화 우선 (산12-4 = 12.4). 같은 마을은 한전 정보 거의 동일이라 영향 없음.
- **반환 개수**: top 5 (DB 단 LIMIT). 같은 마을은 보통 같은 정보라 더 많이 보여줘도 노이즈만.
- **UI**: 마을검색 모달의 `LocationDetailGrouped` 컴포넌트 재활용 + `compact` 옵션. 새 컴포넌트 0.
- **HTTP 캐시**: `private, max-age=600` (10분).

## DB (마이그레이션 044 + 044b)

- 유틸: `jibun_to_num(text) → numeric` (IMMUTABLE).
- RPC: `fallback_kepco_nearest(p_bjd_code, p_target_num, p_limit) RETURNS SETOF kepco_capa`.
- **plpgsql + EXECUTE format** 필수 — `LANGUAGE sql` 변수 바인딩 시 RPC plan trap 으로 풀스캔.
  실측: sql 버전 = 2,493ms (87만건 풀스캔) → EXECUTE 버전 = 42ms (인덱스 정상).
  관련: [reference_supabase_rpc_plan_trap.md](reference_supabase_rpc_plan_trap.md)

## 정규화 규칙 (TS jibunToNumber ↔ SQL jibun_to_num 동일)

| 입력 | 결과 |
|---|---|
| `1072` | 1072 |
| `1072-3` | 1072.3 |
| `산12-4` | 12.4 |
| `1072의1` | 1072.1 |
| `1072전`, `B1072`, `1072가` | 1072 |
| `''`, `'산'`, NULL | null (정렬에서 자동 제외) |

## 잠재 함정

- **클라이언트 모듈 캐시** (`lib/kepco/by-pnu.ts`) 가 페이지 라이프타임 동안 살아있어 코드 배포 후에도 캐시된 PNU 는 fallback 안 보일 수 있음. **Ctrl+F5 새로고침 필요**.
- 도심 큰 마을 (수천 row) 은 미측정 — 운영 모니터링.
- 한 마을 안에 변전소 다른 row 가 섞이면 LocationDetailGrouped 가 자동 그룹화 (compact 모드도 그룹별 분리 유지).

## 위치

- DB: [db/migrations/044_jibun_normalize_fallback.sql](../../db/migrations/044_jibun_normalize_fallback.sql), [044b_fallback_rpc_execute.sql](../../db/migrations/044b_fallback_rpc_execute.sql)
- API: [web/app/api/capa/by-pnu/route.ts](../../web/app/api/capa/by-pnu/route.ts)
- 클라이언트: [web/lib/kepco/by-pnu.ts](../../web/lib/kepco/by-pnu.ts), [web/lib/geo/pnu.ts](../../web/lib/geo/pnu.ts)
- UI: [web/components/map/ParcelInfoPanel.tsx](../../web/components/map/ParcelInfoPanel.tsx) ElectricTab + [web/components/map/LocationDetailGrouped.tsx](../../web/components/map/LocationDetailGrouped.tsx) compact 옵션