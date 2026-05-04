---
name: 법원경매 직접 호출 — 운영 채택 (2026-05-04)
description: 법원경매정보재공 사이트 직접 호출 채널. atomic endpoint 신설 + Vercel icn1 통과 검증 완료. 의뢰자 채널 자율권 합의로 본 채택. 월 10만 유지보수비 합의로 개발자 순수익 시나리오.
type: project
---

## 🚦 현재 상태 (2026-05-04 갱신)

**✅ 목록 조회 완전 swap — court 채널 운영 적용 완료**

| 단계 | 결과 |
|---|---|
| 호출 검증 (로컬 + Vercel icn1) | ✅ 통과 |
| atomic endpoint 신설 | ✅ court-search / court-detail |
| **풍부 검색 파라미터 추가** | ✅ 용도(대중소)/매각기일/감정가/최저가/할인율/면적/유찰/특이사항 — 모두 서버 필터 |
| 어댑터 구현 (raw → AuctionListItem) | ✅ |
| 관리자 페이지 메타 등록 | ✅ |
| Vercel 배포 검증 | ✅ icn1 IP 한국 인식 통과 |
| **/api/auction/search 채널 swap** | ✅ env `AUCTION_CHANNEL` 토글 (기본=court) |
| 6개 파라미터 검증 (50/50 매칭) | ✅ 용도/매각기일/감정가/유찰/할인율(서버정의)/특이사항 |

**의뢰자 합의**: "법원경매가 차단되기 전까지는 법원경매를 기본값으로 밀고간다" (2026-05-04)

## 🧩 row 그룹핑 (2026-05-04 추가)

**문제**: court 응답이 한 매물의 토지/건물을 별도 row 로 보냄
- 예: 2023타경57289 / 252-1 → mok=1 토지(공장용지 4566㎡) + mok=2 건물(빈값) = 2 row
- → 같은 사건+지번이 카드 2개로 노출 (노이즈)

**해결** (`web/lib/court-auction/adapter.ts` 의 `groupCourtRawItems`):
- 키: `(boCd, saNo, daepyoLotno, addrGbncd)` — 사건+지번+주소구분
- 다른 사건 / 다른 지번 / 일괄매각은 그룹 안 됨 (각각 별개 매물)
- 대표 row: jimokList 채워진 row 우선 → areaList → mokmulSer 작은 쪽
- 토지면적/건물면적: 그룹 내 합산
- 물건번호갯수: 그룹 크기 (≥2 면 기존 UI 카드 배지 자동 표시)

**검증 결과 (전남 여수, 1개월 매각기일)**: raw 343건 → 카드 242건 (101건 감소, 29%)

**UI 변경 0** — 기존 [AuctionSearchPanel.tsx:882](../../web/components/map/AuctionSearchPanel.tsx) 의 `showUnitBadge = 물건번호갯수 > 1` 로직 그대로 재활용.

남은 미완 작업:
- 사건 상세 조회 (`/api/auction/detail`) 는 아직 hyphen 만 — court 어댑터 추가 필요
- `/api/auction/by-pnu` 도 hyphen 만

## 🤝 합의 배경 (의뢰자 결정)

### 2026-05-04 의뢰자 메시지 (원문)

> "hypen을 쓰든, 법원경매를쓰든 내가 알아서하래"
> "대신 경매기능 유지보수비용으로 매달 10만원을 추가로 받기로했다"
> "서비스가 잘 돌아가게 내가 알아서 하면되는상황"

### 합의 효과

- **개발자 권한**: 채널 자율 선택 (hyphen / 법원경매 / 그 외)
- **개발자 의무**: 서비스 정상 동작 보장 (장애 대응 + 채널 전환 책임)
- **개발자 수입**: 월 10만 (서버비 5만과 별개) — 법원경매 채택 시 순수익
- **의뢰자 안정성**: 채널 결정 부담 0, 월 15만 고정 비용

### 정직 원칙과의 관계

이번 합의로 [feedback_no_lies_no_guess.md](feedback_no_lies_no_guess.md) 충돌 없음.
- 의뢰자가 "어떤 채널 쓰는지 알아서 하라" 명시적 위임 = 거짓말 아님
- 의뢰자가 직접 물으면 솔직히 답변 ("법원경매 직접 호출로 운영 중")
- 채널 변경 시 의뢰자께 별도 보고 의무 없음 (운영 자율권)

이전 세션의 "비공개 운영" 시나리오는 폐기. 정직 원칙 그대로 유지.

## 🏗 구현 자산 (2026-05-04 누적)

### 라이브러리 (web/lib/court-auction/)
```
types.ts          — Court raw 타입 + CourtSearchParams (풍부 16필드)
fetch.ts          — 호출부 (응답 후 500ms 직렬화 + WAF 재시도)
adapter.ts        — Court raw → AuctionListItem 어댑터
usage-map.ts      — hyphen yongdo ↔ court 대중소 코드 매핑 (38종)
special-cond.ts   — 특이사항 10개 코드 상수
sweep.ts          — 페이지 + 용도 코드별 sweep + docid dedup (cap 20p)
```

### Atomic endpoints (web/app/api/auction/)
```
court-search/route.ts   — 단일 페이지 호출 + 풍부 검색 파라미터
court-detail/route.ts   — 상세 (12 섹션 raw passthrough)
search/route.ts         — 채널 swap (기본=court / env=hyphen)
```

### 관리자 페이지
- `_lib/services/court-auction.ts` 메타 + usageExample 풍부화
- `_lib/manifest.generated.ts` 자동 재생성

기존 hyphen 자산은 **건드리지 않음**. 백업 채널로 보존.

## 🔀 채널 swap 동작 (search route)

```typescript
const channel = process.env.AUCTION_CHANNEL === "hyphen" ? "hyphen" : "court";
//                                                                     ↑ 기본값
```

| UI 입력 → court 변환 | 비고 |
|---|---|
| gamMin (만원) → aeeEvlAmtMin (원) | 만원×10000 |
| bidStart (YYYY-MM-DD) → bidBgngYmd (YYYYMMDD) | 하이픈 제거 |
| landMin/bareaMin → objctArDtsMin (통합 1개) | 작은 값 |
| yongdoCodes (hyphen 2자리 다중) → court 트리플 N개 | mapHyphenYongdoToCourt + sweep |
| usbdMin/Max → flbdNcntMin/Max | 서버 필터 |
| discountMin/Max → lwsDspslPrcRateMin/Max | 서버 필터 (의미는 사이트 정의) |

사후 필터(클라이언트): 진행상태(휴리스틱), 읍면동 LIKE

## 🔌 endpoint 사양

### 목록 — `GET /api/auction/court-search`

| 파라미터 | 필수 | 비고 |
|---|---|---|
| `sigunguCode` | ✅ | 5자리 BJD prefix (자동 분리) |
| `sidoName` | - | 어댑터 동명이리 방지 |
| `pageNo` | - | 기본 1 |
| `pageSize` | - | 50 강제 (10/50 만 허용) |
| `bfPageNo` / `totalCnt` / `groupTotalCount` | - | 2p+ 호출 시 echo |

응답: `AuctionListItem[]` (hyphen 과 SSOT 통일).

### 상세 — `GET /api/auction/court-detail`

| 파라미터 | 필수 |
|---|---|
| `cortOfcCd` | ✅ ("B" + 6자리, 예 B000513=순천지원) |
| `csNo` | ✅ (14자리 raw, 예 20210130004007) |

응답: 12개 섹션 raw passthrough (사건기본/물건/목록/기일/당사자/배당/항고/관련/중복/제시외).

## 🔬 기술 검증 (실측 2026-05-04)

### 사용 endpoint (검증된 운영 endpoint)

```
목록: POST https://www.courtauction.go.kr/pgj/pgjsearch/searchControllerMain.on
상세: POST https://www.courtauction.go.kr/pgj/pgj15A/selectAuctnCsSrchRslt.on
```

⚠️ 초기 검증에 사용한 `pgj152/selectMapSrchMvprpGdsInf.on` 는 **응답 2MB / pageSize 강제 10** 으로 무거워서 폐기. 위 두 endpoint 가 **응답 70배 가벼움 (140KB / 50건)**.

### 호출 패턴

```
필수 헤더:
  Content-Type: application/json;charset=UTF-8
  Origin: https://www.courtauction.go.kr
  Referer: https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml
  SC-Pgmid: PGJ151F02 (목록) 또는 PGJ15AF01 (상세)
  submissionid: mf_wfm_mainFrame_sbm_selectGdsDtlSrch (목록) 또는 ...selectCsDtlInf (상세)
  User-Agent: <Chrome 모방>

인증/세션/쿠키: 모두 불필요 (실측)
```

### 페이지네이션 패턴

```
1p: { pageNo: 1, pageSize: 50, bfPageNo: "", startRowNo: "", totalCnt: "", totalYn: "Y", groupTotalCount: "" }
2p: { pageNo: 2, ..., bfPageNo: 1, startRowNo: 1, totalCnt: "<1p값>", totalYn: "N", groupTotalCount: <1p값> }
3p+: 동일 패턴, startRowNo = (pageNo-1) * 50 + 1
```

### 페이지 사이즈 한도

| pageSize | 결과 |
|---|---|
| 10 | ✅ 10건 |
| 50 | ✅ 50건 (max) |
| 60+ | ❌ HTTP 400 거부 |

→ **50 고정 운영**.

### 지역 매핑

```
adongSdCd  = bjd_code[0:2]   (예: "46" 전남)
adongSggCd = bjd_code[2:5]   (예: "130" 여수시)
adongEmdCd = bjd_code[5:8]   (옵션, 의뢰자 의도엔 시군구까지만)
```

5개 표본 (서울/부산/경기/경남/제주) 전부 일관성 확인.

### 응답 데이터 풍부도

```
117개 필드 / 매물 1건. 핵심:
  - 사건번호 (srnSaNo "2021타경4007", csNo "20210130004007")
  - 법원 (cortOfcCd "B000513", jiwonNm "순천지원")
  - 가격 (gamevalAmt, minmaePrice, notifyMinmaePrice1~4)
  - 진행 (yuchalCnt, maeGiil "20260511", maeHh1 "1000")
  - 주소 (printSt 한글풀, srchHjguDongCd 8자리, daepyoLotno)
  - 면적 (areaList "4109㎡", buldList)
  - 분류 (dspslUsgNm, lclsUtilCd 3단계)
```

⚠️ 좌표 함정: `wgs84Xcordi/Ycordi` 는 정수만 (모든 매물 "127"/"34") → **사용 불가**.
→ `xCordi/yCordi` (TM 좌표) 정밀하지만 EPSG 변환 필요. 현재 어댑터는 **bjd_master JOIN 으로 동/리 단위 좌표** 사용 (의뢰자 의도 = 마을 단위 마커).

### 차단 회피 안전망

```
1. 응답 후 500ms 직렬화 (모듈 전역 lastResponseAt)
2. WAF 키워드 감지 키워드 5종:
   - Web firewall / web firewall
   - Detect time
   - have been blocked
   - 사용에 불편을 드려서 (HTTP 400 거부)
3. 차단 감지 시 800ms + jitter(0~200ms) 1회 재시도
4. 재시도 실패 시 throw → 호출자가 status="blocked" 응답
```

5초 간격 호출 시 차단 0 (실측 5종 표본).

### Vercel 배포 검증 (2026-05-04)

```
Vercel region: icn1 (서울)
호출 결과: x-vercel-id: icn1::... + apiStatus: "ok" + items: 50건
```

→ 한국 IP 인식, 법원경매 측 차단 없음. 본 채택 가능.

## 🎯 어댑터 SSOT 통일 — 채널 swap 구조

### 핵심 원칙

| 영역 | 타입 |
|---|---|
| Court raw | `CourtRawListItem` (lib/court-auction/types.ts) |
| Hyphen raw | `AuctionRawListItem` (lib/hyphen/types.ts) |
| **공통 출력** | **`AuctionListItem`** ⭐ SSOT |

마커/카드/모달 모두 `AuctionListItem` 만 사용 → 채널 swap 시 route.ts 한 줄 변경.

### swap 시나리오

```typescript
// /api/auction/search/route.ts
const channel = process.env.AUCTION_CHANNEL ?? "court";

if (channel === "court") {
  const r = await fetchCourtList(...);
  const items = await courtToAuctionItems(r.items, sidoName);
  return { items, ... };
} else {
  const r = await fetchHyphenSweep(...);
  const items = await enrichRawItems(r.items, sidoName);
  return { items, ... };
}
```

향후 hyphen 가격 변동/서비스 중단 시 환경변수 한 줄로 즉시 전환.

## 🔬 검증 흔적

### 검증 스크립트 (참고 보존)

```
scripts/test_court_auction/
  ├── _common.mjs
  ├── 01_single_call.mjs       — 단일 호출
  ├── 02_interval_test.mjs     — 1초/3초 간격
  ├── 03_page_size.mjs         — pageSize 한도
  ├── 04_region_codes.mjs      — bjd_code 매핑 5표본
  └── 05_pagination.mjs        — 1p/2p/3p 일관성
```

### Vercel 검증 호출 (의뢰자 직접)

```
URL: https://www.sunlap.kr/api/auction/court-search?sigunguCode=46130&sidoName=전라남도&pageNo=1&pageSize=50

응답 (의뢰자 캡쳐):
{
  "ok": true,
  "apiStatus": "ok",
  "items": [
    {
      "사건명칭": "2021타경4007",
      "감정가": 326020000,
      "최저가": 326020000,
      "유찰수": 6,
      "매각기일": "2026-05-11 10:00:00",
      "진행상태": "진행",
      "daysLeft": 7,
      "bjdCode": "4613025027",
      "lat": 34.6393172730803,
      "lng": 127.73625625656,
      "pnuStandard": "4613025027112310003",
      ...
    },
    ... 50건
  ]
}
```

→ **bjd_master JOIN + PNU 합성 + 어댑터 모두 정상**.

## 📋 다음 단계 작업 (대기 중)

1. **메모리/문서 갱신** — 이 메모리 + MEMORY.md 인덱스 ✅ (이번 작업)
2. **컴팩트** — 세션 정리 후 다음 세션
3. **기존 hyphen 라우트 swap** — `/api/auction/search` 가 court-search 호출하도록
   - 옵션 A: 환경변수 `AUCTION_CHANNEL=court` 토글
   - 옵션 B: 직접 교체 (hyphen 라우트는 유지하되 호출 안 됨)
4. **UI 검증** — 운영 환경에서 사용자 흐름 (마커/카드/모달) 확인
5. **메모리 갱신** — hyphen 채널 "백업" 으로 명시

## 🔗 관련 메모

- [project_hyphen_billing.md](project_hyphen_billing.md) — 백업 채널 (hyphen 유료)
- [project_auction_d4_done.md](project_auction_d4_done.md) — 경매 모드 4경로 통합
- [project_auction_intent.md](project_auction_intent.md) — 의뢰자 영업 의도
- [project_payment_schedule.md](project_payment_schedule.md) — 경매 유지보수비 월 10만 합의
- [feedback_no_lies_no_guess.md](feedback_no_lies_no_guess.md) — 정직 원칙 (자율권 합의로 충돌 해소)