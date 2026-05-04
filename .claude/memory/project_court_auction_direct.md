---
name: 법원경매 직접 호출 — 검증됨, 미채택 (백업 채널)
description: 법원경매정보재공 사이트 직접 호출 검증 완료. 2026-05-04 의뢰자 결정으로 hyphen 유료 채택, 직접 호출은 백업 카드로 보존. 향후 hyphen 가격 인상/서비스 중단 시 활용.
type: project
---

## 🚦 현재 상태 (2026-05-04)

**미채택 — hyphen 유료 채택 결정**

> "알겠다 일단 hypen부터 해보자" (의뢰자, 2026-05-04)

직접 호출 채택 검토했으나 의뢰자가 hyphen 유료 전환 방향으로 결정. 이 메모리는 **검증 결과 + 향후 백업 카드** 로 보존.

## 🎯 보존 사유

1. **검증 완료된 자산** — curl 한 번에 응답 받는다는 사실, 응답 구조, 필수 헤더, WAF 동작 — 다 측정됨. 다시 처음부터 검증할 필요 없음
2. **백업 채널** — hyphen 가격 인상 / 서비스 중단 / 단가 폭등 시 즉시 전환 가능
3. **3차 협상 카드** — 의뢰자가 비용 절감 원하면 옵션으로 제시 가능 (의뢰자 본인이 결정)

## ⚠️ 한 차례 검토되었던 비공개 운영안 — 폐기됨

2026-05-04 한 시점에 의뢰자가 "hyphen 으로 개발했다 안내하고 실제는 직접 호출" 운영안 검토. Claude 가 정직 원칙 ([feedback_no_lies_no_guess.md](feedback_no_lies_no_guess.md)) 을 들어 진행 보류. 의뢰자가 최종적으로 hyphen 유료 채택으로 결정 — 비공개 운영 시나리오는 **폐기, 향후에도 채택 금지**.

향후 직접 호출 전환 시: 반드시 의뢰자께 정직하게 안내하고 명시적 동의 받은 후 진행.

## 📋 직접 호출의 합리성 (검토 시 근거)

1. **로그인 없이 누구나 접근 가능 = 공개정보** — 크롤링 법적 문제 낮음 (네이버 v. 다음 2017 판례 흐름)
2. **KEPCO 수집기도 같은 패턴** — 한전 사이트 ajax 직접 호출, 1년 가까이 운영 중 무이슈
3. **hyphen 결제 구조 부담** — 멤버십 11만/월 + 호출당 종량 (단가 미공시) → 비용 예측 불가

→ 기술적 위험은 KEPCO 와 동급. 다만 영업 도구 안정성 + 의뢰자 정직 원칙 차원에서 hyphen 채택.

## 🚦 향후 전환 시나리오 (백업 카드)

법원경매 직접 호출은 **검증된 백업 채널**. 다음 상황에서 의뢰자께 옵션 제시:

- **hyphen 가격 인상** — 11만/월 → 더 비싸지면 비용 비교 자료로 활용
- **hyphen 서비스 중단** — 즉시 전환 가능 (코드는 만들어두지 않았으나 검증 완료)
- **3차 협상 시 비용 절감 원할 경우** — "이런 옵션도 있다" 정직하게 안내

전환 시 **반드시** 의뢰자께 정직하게 옵션 안내 + 명시적 동의 받은 후 진행.

## 🔬 기술 검증 결과 (2026-05-04 실측)

### 호출 방식

```
POST https://www.courtauction.go.kr/pgj/pgj152/selectMapSrchMvprpGdsInf.on
Content-Type: application/json;charset=UTF-8
Origin: https://www.courtauction.go.kr
Referer: https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ152F00.xml
SC-Pgmid: PGJ152F02
submissionid: mf_wfm_aroundGds_sbm_selectMapSrchMvprpGdsInf

Body: {
  "dma_search": {
    "adongSdCd": "11",       // 시도 코드 2자리
    "adongSggCd": "740",     // 시군구 코드 3자리 (시도+시군구 = 5자리 BJD prefix)
    "adongEmdCd": "",        // 읍면동 (선택)
    ...
  },
  "dma_pageInfo": {
    "pageNo": 1,
    "pageSize": 10,
    ...
  }
}
```

### 응답 데이터 (검증 완료)

- **사건번호 / 법원 / 경매계 / 전화번호**
- **감정가** (`gamevalAmt`)
- **최저가** (`minmaePrice`, `notifyMinmaePrice1~4`)
- **유찰 횟수** (`yuchalCnt`)
- **매각기일** (`maeGiil`, `maegyuljGiil`, `maeHh1`)
- **주소** (지번 + 도로명 둘 다)
- **면적** (`pjbBuldList`, `minArea`/`maxArea`)
- **위경도 좌표 직접 제공** (`xCordi/yCordi`, `wgs84Xcordi/Ycordi`)
- **사진 목록** (위치도/관련사진/공부)
- **용도 분류 코드** (`lclsUtilCd/mclsUtilCd/sclsUtilCd`)

→ hyphen 응답과 거의 동일. **bjd_master JOIN 불필요** (위경도 직접 제공).

### 필수 헤더 (제거 시 WAF 차단)

- `Content-Type: application/json;charset=UTF-8`
- `Origin: https://www.courtauction.go.kr`
- `Referer: https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ152F00.xml`
- `SC-Pgmid: PGJ152F02`
- `submissionid: mf_wfm_aroundGds_sbm_selectMapSrchMvprpGdsInf`

### 인증 불필요

- 쿠키/세션 모두 빼도 200 OK 정상 응답
- `WMONID`, `JSESSIONID`, `SID` 등 모두 무관

### WAF 작동 — 주의

- 짧은 시간에 여러 번 호출 시 **IP 자체 차단** (HTTP 200 + WAF HTML 차단 페이지)
- 차단 회복 시간 미확인 (수 분 ~ 수 시간 추정)
- **호출 간격 직렬화 필수** — 건축HUB 와 동일 패턴 (응답 후 500ms 대기)
- 사실상 KEPCO 수집기와 같은 운영 모델 — 적재 후 DB 만 조회

## 🔗 관련 메모

- [project_hyphen_billing.md](project_hyphen_billing.md) — 채택된 채널 (hyphen 유료)
- [project_auction_d4_done.md](project_auction_d4_done.md) — 경매 모드 4경로 통합
- [project_auction_intent.md](project_auction_intent.md) — 의뢰자 영업 의도
- [feedback_no_lies_no_guess.md](feedback_no_lies_no_guess.md) — 정직 원칙 (직접 호출 비공개 운영안 폐기 사유)