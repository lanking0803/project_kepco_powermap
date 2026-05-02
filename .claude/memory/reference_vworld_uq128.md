---
name: VWorld lt_c_uq128 (자연취락지구) — 호출 함정
description: VWorld WFS 자연취락지구 호출 시 OGC FILTER (XML) 만 작동. CQL_FILTER/attrFilter 무시 함정. 시군구 5자리까지만 필터 가능, 읍면동/리 단위 직접 매칭 불가.
type: reference
---

# VWorld WFS `lt_c_uq128` — 호출 사실 검증 (2026-05-02)

## typename
- `lt_c_uq128` = 용도지구 → 자연취락지구 (uname="자연취락지구")

## 응답 필드 (실호출 검증)
| 필드 | 자릿수 | 의미 |
|---|---|---|
| `mnum` | — | 자연취락지구 고유키 |
| `uname` | — | "자연취락지구" |
| `std_sggcd` | 5 | 법정 시군구 코드 (bjd_code 앞 5자리와 동일) |
| `admin_cd` | 7 | 행정안전부 행정동 코드 (시군구/구 단위, 읍면동까지 안 내려감) |
| `sido_cd` | 2 | 시도 |
| `sigungu_cd` | 3 | 시군구 (sido_cd 와 합치면 std_sggcd) |
| `sido_name`, `sigg_name` | — | 시도명/시군구명 |
| `geometry` | — | MultiPolygon GeoJSON |

→ ⚠️ **읍면동 단위 코드/이름 없음**. bjd_code 10자리 매칭 불가. 시군구 단위 응답 후 클라이언트에서 후처리 필수.

## 필터 형식 — OGC FILTER (XML) 만 작동

❌ **CQL_FILTER 무시**: `CQL_FILTER=std_sggcd='52110'` → 필터 안 먹음, 처음부터 N건 그대로
❌ **attrFilter 무시**: 동일하게 무시
✅ **FILTER (XML, FES 2.0)** — 기존 `lib/vworld/admin-polygon.ts` 와 동일 패턴

```xml
<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0">
  <fes:PropertyIsEqualTo>
    <fes:ValueReference>std_sggcd</fes:ValueReference>
    <fes:Literal>52110</fes:Literal>
  </fes:PropertyIsEqualTo>
</fes:Filter>
```

→ URL-encode 해서 `&FILTER=...` 로 전달. version=2.0.0.

## bbox 함정 (참고)
- WFS 2.0.0 + bbox 파라미터 = 0건 응답 (좌표계 인식 이슈)
- bbox 쓰려면 1.1.0 + EPSG:4326 명시 필요 — 그러나 우리는 쓸 일 없음 (필터 사용)

## How to apply

- 자연취락지구 외 다른 용도지구 typename(`lt_c_uq111` 경관지구 등) 도 동일 함정 가능성 높음 → 처음부터 OGC FILTER (XML) 로
- 같은 패턴: [admin-polygon.ts](../../web/lib/vworld/admin-polygon.ts) — 행정구역 폴리곤도 OGC FILTER 사용 (정상 작동)
- 우리 구현: [lib/vworld/uq-villages.ts](../../web/lib/vworld/uq-villages.ts)

## 갱신 주기
- 분기 1회 (정부 도시계획 변경 시) → HTTP 캐시 1주 + SWR 1일 안전