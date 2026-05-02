---
name: VWorld lt_c_uq128 (취락지구) — 함정 모음 + 회피 전략
description: VWorld WFS 취락지구 호출 함정 5종 — OGC FILTER 전용/일반시 등록 단위 불일치/uname 자연·집단 혼재/sigg_name 부정확/읍면동 코드 없음. 회피는 sgg-strategy + uname 필터 + std_sggcd 단독 신뢰.
type: reference
---

# VWorld WFS `lt_c_uq128` — 함정 모음 (검증 2026-05-02)

## typename
- `lt_c_uq128` = 용도지구. 응답에 **자연취락지구 + 집단취락지구 혼재** (함정 4 참고).

## 응답 필드 (실호출 검증)
| 필드 | 자릿수 | 의미 |
|---|---|---|
| `mnum` | — | 폴리곤 고유키 (dedup 키로 사용) |
| `uname` | — | "자연취락지구" or "집단취락지구" |
| `std_sggcd` | 5 | 법정 시군구 코드 — **유일하게 신뢰 가능한 시군구 식별자** |
| `admin_cd` | 7 | 행정안전부 행정동 코드 (시군구/구 단위까지) |
| `sido_cd` / `sigungu_cd` | 2 / 3 | 시도/시군구 분리 코드 |
| `sido_name` / `sigg_name` | — | 시도명/시군구명 — **라벨 부정확 사례 있음** (함정 3) |
| `dyear` / `dnum` | — | 고시년도/고시번호 |
| `geometry` | — | MultiPolygon GeoJSON |

→ **읍면동/리 단위 코드/이름 없음**. bjd_code 10자리 매칭 불가, 시군구 단위 응답 후 클라이언트 후처리 필수.

## 함정 1: 필터 형식 — OGC FILTER (XML, FES 2.0) 만 작동

❌ `CQL_FILTER=std_sggcd='52110'` 무시당함 — 처음부터 N건 그대로
❌ `attrFilter=std_sggcd:52110` 동일하게 무시
✅ FES 2.0 OGC FILTER:
```xml
<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0">
  <fes:PropertyIsEqualTo>
    <fes:ValueReference>std_sggcd</fes:ValueReference>
    <fes:Literal>52110</fes:Literal>
  </fes:PropertyIsEqualTo>
</fes:Filter>
```
URL-encode 해서 `&FILTER=...`. version=2.0.0.

## 함정 2: 일반시 등록 단위 불일치 ⭐ (검색 모드 핵심)

**bjd_master 표준 5자리 ≠ VWorld std_sggcd 등록 단위**:

| 시 | 시 단위(4자리+0) | 일반구 단위(5자리) |
|---|---|---|
| 천안시 | 50건 ✅ | 동남구(44131) 0 / 서북구(44133) 0 |
| 수원시 | 16건 ✅ | 권선구(41113) 0 / 영통구(41117) 0 |
| 창원시 | 96건 ✅ | 의창구·성산구 등 0 |
| **성남시** | **4건** | **분당구(41135) 10건** ⚠️ 둘 다 따로! |

→ 일반시 일반구 검색 시 **시 단위 + 구 단위 둘 다 호출 필수**. mnum dedup.

회피: [lib/uq/sgg-strategy.ts](../../web/lib/uq/sgg-strategy.ts) `getUqQuerySggCodes(sigunguCode)`
- 5번째 자리 == "0" → 단일 호출 (일반 군/광역시 자치구/일반시 자체)
- 5번째 자리 != "0" → [4자리+0, 원본] 둘 다 호출

## 함정 3: sigg_name 라벨 부정확

예: `std_sggcd=44760` (예산군) 호출 시 응답 `sigg_name="부여군"` 라벨이 박혀옴. count 자체는 예산군 정상(163건). VWorld 내부 라벨 오류.

→ **시군구 식별은 std_sggcd 코드만 신뢰**. sigg_name 텍스트는 UI 라벨 보조용으로만.

## 함정 4: uname 에 자연취락지구 + 집단취락지구 혼재

같은 typename `lt_c_uq128` 응답에 두 종류 섞임:

| 영역 | 자연취락지구 | 집단취락지구 |
|---|---|---|
| 자연/관리/농림/자환 지역 마을 | ✅ (영업 가치 ⭐) | — |
| **개발제한구역(그린벨트) 안 마을** | — | ✅ (영업 가치 ❌) |

영업 의도 = 자연취락지구만 (창고 짓고 태양광). 집단취락지구는 **그린벨트 신축 제한** 강해 영업 무관.

회피: [lib/vworld/uq-villages.ts](../../web/lib/vworld/uq-villages.ts) 에서 `props.uname !== "자연취락지구"` 행 스킵.

서울 강남구/종로구 등 도심 광역시 자치구는 응답 4건이 모두 집단취락지구 = 자연 필터 후 0건이 정상.

## 함정 5: bbox 파라미터

WFS 2.0.0 + bbox = 0건 응답 (좌표계 인식 이슈). bbox 쓰려면 1.1.0 + EPSG:4326 명시 필요. 우리는 std_sggcd 필터만 사용해 회피.

## 회피 흐름 정리

```
[사용자 시군구 선택]
   sigunguCode (5자리, bjd_master 표준)
   ↓
[lib/uq/sgg-strategy.ts] getUqQuerySggCodes
   1~2개 std_sggcd 후보 [시단위, 구단위?]
   ↓
[lib/api/vworld.ts] fetchVworldUqVillagesByQuery
   각 sgg 별 atomic 호출 → 응답 합치고 mnum dedup
   ↓
[lib/vworld/uq-villages.ts] uname === "자연취락지구" 필터 (서버 lib)
   ↓
[lib/uq/match-village.ts] 사용자가 선택한 sigunguCode prefix 마을만 후보로 KNN
   → 일반시 일반구 검색 시 시 단위 응답에서 자동으로 그 구 영역만 노출
```

## How to apply

- 다른 용도지구 typename(경관지구 `lt_c_uq111`, 보존지구 `lt_c_uq125` 등) 도 동일 함정 가능성 높음 (함정 1·2·3·5).
- 일반 행정구역 API (lt_c_adsido/adsigg/ademd/adri) 는 std_sggcd 표준 일치 가능성 높지만 검증 후 사용.
- bjd_master 와 외부 정부 데이터 단위가 일치한다고 가정 금지 — **반드시 실 호출 검증**.
- 정부 공공 데이터에서 같은 영역 코드를 시·구 따로 등록한 사례는 흔함 → 호출 전략 일반화 필요.

## 갱신 주기
- 분기 1회 (정부 도시계획 변경 시) → HTTP 캐시 1주 + SWR 1일 안전
