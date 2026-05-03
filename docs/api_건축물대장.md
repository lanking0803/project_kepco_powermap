# 건축물대장 API (건축HUB) — 실제 호출 검증 완료

> 메모리 요약: [.claude/memory/reference_bldg_register_api.md](../.claude/memory/reference_bldg_register_api.md)

## 📌 결론 (2026-04-16 실측)

- **API 정상 작동 확인**. 키·endpoint·파라미터 모두 검증 완료.
- 2차 개발(유리온실/축사/일반건물 + 평수 필터)에 **그대로 사용 가능**.
- 단, **비닐하우스/간이시설은 등록 대상이 아니라 거의 안 잡힘** — 한계 명확.

---

## 🔌 호출 정보

- **End Point**: `https://apis.data.go.kr/1613000/BldRgstHubService`
- **서비스 ID**: 15134735 (공공데이터포털 — 국토교통부 건축HUB)
- **인증키**: `docs/SECRETS.local.md` 의 "공공데이터포털 — 건축HUB" 섹션
- **트래픽**: 10,000건/일 (개발계정, 무료, 자동승인)
- **포맷**: `&_type=json` 권장 (생략 시 XML)

### 핵심 오퍼레이션 (10개 중 우리 용도)

| 오퍼레이션 | 용도 | 우리 사용 여부 |
|---|---|---|
| `getBrTitleInfo` | 표제부 — 동별 주용도/연면적/건축면적/구조/지붕/층수 | ⭐ 메인 |
| `getBrRecapTitleInfo` | 총괄표제부 — 단지 합계 + 부속건물 + 에너지등급 | ⭐ 메인 |
| `getBrFlrOulnInfo` | 층별개요 — 층별 면적/용도 | △ 옥상 분석 시 |
| `getBrBasisOulnInfo` | 기본개요 — 대장종류/지역지구구역 | △ 보조 |

### 필수 파라미터 (5개 모두)

```
serviceKey  — Encoding 키 (URL 그대로)
sigunguCd   — 시군구코드 5자리 (예: 11680 강남구)
bjdongCd    — 법정동코드 5자리 (예: 10500 삼성동)
platGbCd    — 0(대지) / 1(산) / 2(블록)
bun         — 본번 4자리 zero-pad (예: 0159)
ji          — 부번 4자리 zero-pad (예: 0000)
```

### 호출 예시 (검증된 URL)

```
https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo
  ?serviceKey=<ENCODED_KEY>
  &sigunguCd=11680&bjdongCd=10500&platGbCd=0&bun=0159&ji=0000
  &_type=json&numOfRows=20&pageNo=1
```

→ COEX 무역회관 9개 동 데이터 정상 반환 확인

---

## 📥 받아오는 핵심 필드

```
platPlc        지번주소 ("서울특별시 강남구 삼성동 159번지")
newPlatPlc     도로명주소 ("영동대로 511")
bldNm          건물명 ("무역회관")
mainPurpsCdNm  주용도 ("업무시설" / "동·식물관련시설" / "공장" 등)  ⭐ 필터링 핵심
etcPurps       기타용도 (세부)
strctCdNm      구조 ("철골조" / "철근콘크리트" / "조적조" 등)
roofCdNm       지붕구조 ("(철근)콘크리트" / "유리" / "슬레이트" 등)
archArea       건축면적 (㎡)  ⭐ 평 변환: ÷ 3.305785 — 우리 시스템 평수 기준
totArea        연면적 (㎡)  ※ 우리는 사용 안 함 (의뢰자 요청, 2026-04-16)
platArea       대지면적 (㎡)
grndFlrCnt     지상층수
ugrndFlrCnt    지하층수
useAprDay      사용승인일 (YYYYMMDD)
```

**평수 기준 규칙 (의뢰자 확정 2026-04-16)**:
옥상 태양광 설치 가용 면적은 **1층 바닥 면적** 이므로 `archArea` (건축면적) 만 사용. `totArea` (연면적) 는 층수 쌓인 값이라 부적합.

---

## ⚠️ 중요 한계 (의뢰자에게 정직하게 안내함)

| 시설 | 등록 여부 | 비고 |
|---|---|---|
| **유리온실** | ✅ 대부분 등록 (특히 100평↑) | 동·식물관련시설 + 지붕 유리 |
| **축사 (콘크리트/철골)** | ✅ 등록 | 동·식물관련시설 |
| **공장/창고/일반건물** | ✅ 등록 | 평수 구간 필터링 OK |
| **비닐하우스** | ❌ 가설건축물, 미등록 | 농어촌정비법, 건축법 미적용 |
| **간이 슬레이트 축사** | △ 일부만 등록 | 가건물 형태는 누락 가능 |

**대안 데이터 (참고)**:
- 농림부 농업시설 통계 — 시군구 합계만, 개별 위치 X
- 위성영상 AI 분석 — 정확하지만 별도 프로젝트 (수백~수천만원)

---

## 🔑 트러블슈팅 — 401 Unauthorized 의 진짜 원인

발급 직후 같은 키로 호출해도 **존재하지 않는 시군구/법정동 조합**일 때 게이트웨이가 401 을 반환함 (NORMAL SERVICE 0건이 아니라).

→ **401 ≠ 키 문제**. 먼저 **검증된 주소** (예: 서울 강남 삼성동 159) 로 200 OK 확인하고, 그 후에 의심되는 주소를 시도할 것.

법정동코드는 **도로명주소 코드 25자리에서 6~10번째 5자리**:
- 예: `4673025025101270000000001` → 시군구 `46730`, 법정동 `25025`
- 도로명주소 검색 후 결과 URL 또는 dorojuso.kr 등에서 추출

---

## 🧬 PNU 합성 — 응답 5필드 → 행안부 표준 PNU 19자리

### 검증 결과 (2026-05-03, 70건 표본)

- **합성 알고리즘 100% 정확** — 형식·prefix(시군구+bjdong)·산구분·zero-pad 모두 표준대로
- **VWorld 지적도 매칭률 83%** (lt_c_landinfobasemap WFS Filter 직접 매칭 기준)
- **실패 17%는 우리 알고리즘 문제 아님** — 다음 두 가지가 원인:
  1. **VWorld 지적도 갱신 지연** — VWorld 토지특성 API(`getLandCharacteristics`) 에서는 ✅ 존재, 같은 VWorld 의 지적도 폴리곤 DB 만 옛 PNU 미반영
  2. **외부 건축HUB 데이터 오표기** — `platPlc: "가람동 3번지"` 인데 실제는 "가람동 산 3" (산지 ↔ 일반 잘못 표기, platGbCd=0 으로 응답)

### 합성 규칙

응답 item 의 5필드만으로 합성 가능 (외부 호출 0회):

```
PNU(19) = sigunguCd(5) + bjdongCd(5) + 산구분(1) + bun(4) + ji(4)
```

**산구분 매핑** (외부 platGbCd → PNU 11번째):
- 외부 `platGbCd`: 0=대지, 1=산, 2=블록
- PNU 11번째: 1=일반, 2=산
- → `platGbCd === '1' → '2'`, 그 외 → `'1'`
- ⚠️ 직관과 반대 (0/1/2 가 아닌 1/2). 검증된 규칙.

**합성 skip 조건** (PNU 만들지 않음):
- `sigunguCd`/`bjdongCd` 가 5자리 숫자가 아닌 경우
- `bun` 이 빈값/0 (메타 row — 빈 platPlc 응답 케이스)

### TS 구현

[web/lib/facility/pnu.ts](../web/lib/facility/pnu.ts) — `buildPnuFromRawItem(item)`. 시설 모드 카드 클릭 시 호출되어 통합 진입점 `openParcelPanelByPnu(pnu)` 로 전달.

### VWorld 검증 함정

**같은 VWorld 안에서도 두 DB 가 다른 결과를 줍니다:**

| API | endpoint | 12-5 같은 옛 지번 | 좌표 제공 |
|---|---|---|---|
| 지적도 WFS | `lt_c_landinfobasemap` | ❌ 없음 | ✅ |
| 토지특성 NED | `getLandCharacteristics` | ✅ 있음 (4 records, 2023년 갱신) | ❌ |

→ 시설 카드 클릭 후 매칭 실패 토스트가 떠도 합성 정확. 외부 데이터 한계.

---

## 🗺 마을 마커 — 좌표 출처 = bjd_master JOIN

**건축HUB 응답에 위경도 없음** (78개 필드 검증, lat/lng/coord 류 0개). 그래서 시설 모드 마을 마커는 **공매·경매와 동일한 패턴**으로 좌표를 보강합니다.

### 좌표 보강 흐름 (공매와 동일)

```
1. 응답에서 sigunguCd(5) + bjdongCd(5) = BJD 10자리 추출
2. unique BJD 코드 셋 → supabase.from("bjd_master").select("bjd_code,lat,lng").in("bjd_code",[...])
   → PostgreSQL 한 방 IN 쿼리 (RPC 아님 — generic plan trap 회피)
3. 좌표 박은 FacilityListItem[] 리턴
```

- **외부 API 호출 0회** (좌표 보강 단계)
- DB 호출 1회 (검색당, IN 절 단일 쿼리)
- egress: 검색당 ~1~2KB (row 1개 ≈ 65B × unique BJD 5~30개)

### Atomic endpoint — `/api/facility/search`

공매(`/api/onbid/search`)·경매(`/api/auction/search`)와 같은 단일 책임 패턴.

**입력**: `bjd_codes` (콤마 구분 10자리 N개) + `categories` (옵션) + `min_pyeong` (옵션)

**서버 흐름**:
1. 각 BJD 자동 페이지 순회 (max 20p = 2,000건/BJD, 외부 API 100 hard cap)
2. `enrichFacilities`: 분류(부속건축물 제외) + 평수 계산 + bjd_master JOIN
3. categories/min_pyeong 사후 필터

**클라이언트 흐름**:
- `FacilitySearchPanel` 이 endpoint 한 번 호출 → 결과 보관
- 카테고리/평수 토글은 클라이언트 useMemo 가 즉시 재필터 (서버 호출 0)
- 부모(`MapClient`) 가 `groupFacilityItemsByVillage` → 마을 단위 1 마커

### 마커 / 카드 / 모달 (공매·경매 미러)

| 컴포넌트 | 역할 | 모델 |
|---|---|---|
| `KakaoMap` `FacilityVillageMarkerData` | 마을 마커 1개 (BJD 10자리 + count + maxPyeong) | `OnbidVillageMarkerData` |
| `.facility-card-marker` (violet) | 가까운 줌 카드 — 평수 메인 + 시설 수 보조 | `.auction-card-marker` |
| `.facility-dot` (violet) | 먼 줌 원형 마커 | `.onbid-dot` |
| `FacilityVillageCard` | 마커 클릭 시 우측 카드 (카테고리 분포 + 평수 통계) | `OnbidVillageCard` |
| `FacilityVillageModal` | [시설 N건 보기] 모달 | `OnbidVillageModal` |
| `FacilityItemCard` | 모달 안 시설 1건 카드 (좌측 지번 컬럼 + 우측 본문) | `AuctionItemCard` |

**zIndex 100/50** — 공매·경매와 동일. 전기 마커(3/10) 위에 떠야 한다는 의뢰자 요구 충족.

**동적 갱신**: `selectedFacilityKey` (BJD 키만 보관) + `useMemo` lookup 으로 카드/모달이 매 렌더마다 현재 필터 결과를 반영. 사이드바에서 카테고리 토글하면 마을 카드의 시설 수/평수/카테고리 분포가 즉시 바뀜.

**모달 닫힘**: 시설 카드 클릭 → `handleFacilityItemClick` → PNU 합성 → `openParcelPanelByPnu` 매칭 성공 시 모달과 마을 카드 자동 정리 (공매·경매와 동일 진입점에서 일괄 cleanup).

---

## 🧪 테스트 스크립트

[scripts/test_bldg_api/test_brtitle.mjs](../scripts/test_bldg_api/test_brtitle.mjs)

- Node.js 22+ 에서 `node scripts/test_bldg_api/test_brtitle.mjs` 로 실행
- 4개 오퍼레이션 모두 호출 후 핵심 필드 출력
- 새 주소 검증 시 ADDRS 배열에 추가
