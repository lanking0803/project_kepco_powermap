---
name: 법원경매 직접 호출 — 운영 채택 (2026-05-04)
description: 법원경매정보재공 사이트 직접 호출 채널. atomic endpoint 신설 + Vercel icn1 통과 검증 완료. 의뢰자 채널 자율권 합의로 본 채택. 월 10만 유지보수비 합의로 개발자 순수익 시나리오.
type: project
---

## 🚦 현재 상태 (2026-05-04 갱신 — by-pnu + 모달 + 풍부화 완료)

**✅ 목록/by-pnu/상세모달 완전 swap — 운영 적용 완료**

| 단계 | 결과 |
|---|---|
| atomic endpoint | ✅ court-search / court-detail |
| /api/auction/search 채널 swap | ✅ env `AUCTION_CHANNEL` (기본=court) |
| **/api/auction/by-pnu 채널 swap** | ✅ 2단계 lazy fallback (emdCd → 시군구) |
| **법원경매 전용 모달 컴포넌트** | ✅ CourtAuctionDetailCard.tsx |
| **AuctionTab 채널 분기** | ✅ courtCaseKey 유무로 자동 분기 |
| **세종시 시군구 자동 처리** | ✅ 36110 자동 세팅 |
| 가격 표기 통일 | ✅ formatWon 공통 헬퍼 (1억+ 소수점1) |
| 회차별 최저가 이력 | ✅ 모달 OverviewCard |
| 권리분석 단서 (청구 vs 최저) | ✅ 잉여/부족 인사이트 |
| 법원경매 사이트 바로가기 | ✅ 사건번호 복사 + 입력 가이드 |

**의뢰자 합의**: "법원경매가 차단되기 전까지는 법원경매를 기본값으로 밀고간다" (2026-05-04)

## 🧩 row 그룹핑 — 사건 단위 통합 (2026-05-04 / 갱신 2026-05-05)

**문제**: court 응답이 한 사건의 매각자산 N개를 별도 row 로 보냄.
- 같은 매물의 토지/건물 row 분리 (mok=1 토지, mok=2 건물)
- 같은 매물의 지번주소(A) / 도로명주소(R) row 분리 (실측: 2023타경57289 / 252-1)
- **일괄매각 사건의 자산별 maemulSer 분리** (실측 2026-05-05: 속초지원 2025타경10210 / 죽왕면 오호리 278-41 → 토지+건물4동이 maemulSer 1/2/3 로 분리되어 카드 3개로 나뉨)

→ 가격/매각기일/유찰/담당계 모두 사건 단위 단일값인데, 자산별로 카드 N개 → 정보 중복 + 사용자 혼란.

**그룹핑 키** (현재, `web/lib/court-auction/adapter.ts` 의 `groupCourtRawItems`):
```
(boCd, saNo)
   |     |
   법원  사건
```

**Why** (사건 단위 = 의사결정 단위):
- 가격/매각기일/유찰/담당계/배당요구종기 등 핵심 정보는 모두 사건 단위로 결정됨
- 일괄매각이든 개별매각이든 사건 1건 = 카드 1개가 자연스러움
- 카드 안의 "매각 자산" 섹션이 자산별 N건을 토글 (이 지번 / 사건 전체) 로 정리
- 매각자산 토글은 상세 응답(`dlt_dspslGdsDspslObjctLst`)을 사용해서 그룹핑 단계와 무관

**대표 row 선정** (= 카드 헤더):
1. **`targetPnu` 매칭 row** ⭐ — by-pnu 흐름에서 사용자 클릭 PNU 매칭되는 row 우선 (사용자가 클릭한 지번이 카드 헤더에 표시되어 컨텍스트 일치)
2. jimokList 채워진 row (= 토지)
3. areaList 채워진 row
4. mokmulSer 가장 작은 row

**by-pnu 호출 경로** — `courtToAuctionItems(rawItems, { targetPnu: pnu })` 로 PNU 주입.
시군구 sweep 마커 흐름은 targetPnu 미전달 → 기존 휴리스틱 유지.

**합산**: 토지면적(jimok 채워진 row), 건물면적(buldList 또는 jimok 빈 row 의 건물 키워드) — 사건 단위 합산.
**물건번호갯수**: 그룹 크기 (사건 안의 row 수). UI 카드 배지에 분류별 표시.

**이전 키** `(boCd, saNo, maemulSer, daepyoLotno)` 는 폐기. maemulSer 분리 함정으로 같은 사건 카드가 N개로 쪼개지는 문제가 발견되어 사건 단위로 통합. 한글 텍스트 비교 회피 원칙은 그대로 유지.

## 🏷 카드 배지 — 분류별 표시 (2026-05-04 추가)

**문제**: 분수 표기 "물건 1/2" 의미 헷갈림 + 분자>분모 깨짐 사례 (대표 row 의 mokmulSer=3, 그룹 크기=2 → "3/2")

**해결**: court 합쳐진 카드는 mokGbncd 분류별 카운트로 표시
- `01` 토지 / `02` 건물 / `03` 집합건물 (아파트/오피스텔)
- 카드 배지: **"토지 1·건물 1"** / **"토지 1·건물 3"** / **"토지 1·집합 1"**
- 0인 분류 생략

**필드**: `AuctionListItem.groupBreakdown?` (court 전용 옵셔널). hyphen 채널/단일 row 면 미존재 → 기존 분수 표기 fallback

**표본 142건 통계**: 합쳐진 그룹 13개 중 11개(85%) "토지 1·건물 1", 최대 "토지 1·건물 3"

남은 미완 작업: **모두 완료** (2026-05-04)

## 🎯 by-pnu 호출 정책 (2026-05-04 신규)

**2단계 lazy fallback** — `web/lib/court-auction/by-pnu.ts`:
```
1차: emdCd 좁힘 sweep (매각기일 6개월 윈도)
   → 매칭 ≥1건? → 즉시 종료 (2차 호출 X)
2차: emdCd 빼고 시군구 sweep — 1차 매칭 0건일 때만
   → court 사이트 emdCd 인덱스 누락 회피 (강남구 740-7 등 실측)
```

**왜 매각기일 6개월 윈도가 필수냐**:
- court 사이트는 `bidBgngYmd/bidEndYmd` 빈값으로 호출하면 **종결 매물 위주로** 응답
- 신건/진행 매물이 첫 50건에 묻혀 빠짐 (실측: 강남구 emdCd 빈값 호출 totalCnt=29 → 740-7 누락)
- 6개월 윈도 추가 → totalCnt=42 + 740-7 정상 포함

**왜 1차 emdCd 좁힘 + 2차 fallback 인가**:
- 1차만으로 95% 케이스 처리 (1페이지 끝, 빠름)
- court 사이트 `rprsAdongEmdCd` 필터에 일부 매물이 누락되는 결함 발견 (강남구 740-7)
- 같은 매물의 raw 가 emdCd 빈값 호출엔 정상 옴 → 2차로 보강
- 무조건 2차까지 가면 모든 사용자 호출 비용 ×2 → 비효율

## 🏛 법원경매 전용 모달 (2026-05-04 신규 / 2026-05-05 풍부화)

**파일**: `web/components/map/auction/CourtAuctionDetailCard.tsx`
**진입**: `AuctionTab` 의 `DetailCardSwitch` — `item.courtCaseKey?.cortOfcCd && csNo` 있으면 court 전용 모달

**섹션 구조**:
1. 헤더 — 진행상태 / 용도 / D-day / 사건명칭 / 평당단가 chip / 유찰 chip
2. 💰 OverviewCard — 감정가 → 최저가 → 할인율 → 회차별 가격 이력 → 다음 회차 추정
3. 짧은 Section 들 (2컬럼) — 법원/담당계 / 면적/단가 / 진행 / 매물 구성
4. **상세 펼치기 (lazy court detail 호출)**:
   - 🧮 권리분석 단서 — 청구금액 vs 최저가 (잉여/부족 인사이트)
   - ⚠️ **매각 비고 / 권리분석 단서** (2026-05-05) — `dspslGdsRmk` bullet 분리 + 위험 키워드(분묘기지권/유치권/법정지상권/대항력 등) 색상 강조 + 일괄매각/개별매각 상단 강조 배지
   - 🏛 사건 기본 — 담당계 전화 + 접수/개시일 + 법원경매 사이트 바로가기
   - 📦 매각 자산 — 토글 [이 지번 / 사건 전체] + 분류별 라벨 + 지번주소
   - 💼 매각 조건 — 보증금률 + 공고기간
   - 📉 **회차별 가격 변화** (2026-05-05) — 각 회차에 진행상태 라벨 통합 (✓ 종료 / 유찰 / 🔜 진행 예정 / 예정). dspslDxdyDnum 으로 진행 회차 판별 + 진행분 row 매칭으로 정확한 결과 표시
   - 📅 **회차 기일 이력** — 진행분 + **다음 매각기일 합성행** (`-PENDING` 코드 → 🔜 예정 배지). 진행분에 동일 날짜 있으면 합성 안 함 (중복 방지)

**raw 응답 한계** (2026-05-05 실측):
- `dlt_rletCsGdsDtsDxdyInf` 가 보통 **1행만** 옴 (가장 최근 진행 회차만). 과거 유찰 정확 일자는 응답에 없음 — 회차별 가격 박스에서 "✓ 종료" 라벨로 대체
- **이미지(부동산 사진)는 별도 endpoint** — `selectAuctnCsSrchRslt.on` 에 안 들어옴. base64 인라인 응답으로 별도 호출 필요 (현재 미구현, 차기)
- **현황조사서/감정평가서 PDF** — 별도 endpoint (의뢰자 결정: 영업 시작 단계엔 불필요)
   - 💼 매각 조건 — 보증금률 + 공고기간 (사건 단위 1번)
   - 📅 회차 기일 이력 — 진행/유찰/매각 배지
   - 👤 당사자 (N명) + 📑 배당요구종기
   - 🔗 관련 사건 / 🔀 중복병합 (있을 때)

## 🏷 가격 표기 통일 정책 (2026-05-04)

`web/lib/format/won.ts` 공통 헬퍼:
- 1억 이상: 소수점 1자리 (15.55억 → "15.6억", 정수면 "1억")
- 1만 이상: 만 단위 (53,174만)
- 그 외: 원

**모든 화면 동일 표기** — 목록 카드, 사건별 카드, court 모달, hyphen 모달 모두.
이전엔 `Math.round(eok)` 으로 10억+ 가 거칠게 반올림되어 15.55억 → 16억 표시 문제 있었음.

## 🛠 어댑터 BJD 매칭 정책 (2026-05-04)

**한글 매칭(`hjguDong/hjguRd`) 사용 금지** — 동명이리 충돌 위험.

**정답**: court raw 의 `srchHjguRdCd`(10자리) 또는 `srchHjguDongCd`(8자리) + "00" 으로 **BJD 코드 직접 매칭**:
```typescript
function resolveBjdCode(raw): string | null {
  if (/^\d{10}$/.test(raw.srchHjguRdCd)) return raw.srchHjguRdCd;
  if (/^\d{8}$/.test(raw.srchHjguDongCd)) return raw.srchHjguDongCd + "00";
  // fallback — daepyoSidoCd + daepyoSiguCd + daepyoDongCd + daepyoRdCd 합성
}
```
→ 화장동 (광주 남구 vs 여수시) 같은 동명 충돌 0.

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