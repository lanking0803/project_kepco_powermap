import type { ExternalServiceMeta } from "../types";

export const meta: ExternalServiceMeta = {
  id: "court-auction-direct",
  name: "법원경매정보재공 — 직접 호출 (운영 채널)",
  category: "court-auction",
  consoleUrl: "https://www.courtauction.go.kr/",
  envKeys: [],
  expiry: null,
  dailyLimit:
    "공식 한도 미공개. 운영 시 응답 후 500ms 직렬화 + 차단 감지 시 800ms+jitter 1회 재시도. 5초 간격 호출 시 차단 0 (실측 2026-05-04).",
  issueGuide: `1. 별도 발급 절차 없음 — 공개 사이트 ajax endpoint 직접 호출
2. 인증/세션/쿠키 모두 불필요 (실측 검증 완료)
3. 환경변수도 없음
4. 운영 즉시 가능

⚠️ 채택 사유 (의뢰자 합의 2026-05-04):
   - 의뢰자 합의: "hyphen / 법원경매 / 그 외 채널 자율 선택 — 서비스 정상 동작 책임"
   - 경매 유지보수비 월 10만 합의 (서버비 5만과 별개)
   - hyphen 대비 응답 70배 가벼움 (140KB / 50건), 인증 부담 0`,
  usageExample: `# 목록 (시군구 단위, 페이지네이션)
POST https://www.courtauction.go.kr/pgj/pgjsearch/searchControllerMain.on
Headers:
  Content-Type: application/json;charset=UTF-8
  Origin: https://www.courtauction.go.kr
  Referer: https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml
  SC-Pgmid: PGJ151F02
  submissionid: mf_wfm_mainFrame_sbm_selectGdsDtlSrch
Body:
  {
    "dma_pageInfo": {
      "pageNo": 1,
      "pageSize": 50,                        # 10/50 만 허용 (60+ 거부)
      "bfPageNo": "", "startRowNo": "",
      "totalCnt": "", "totalYn": "Y",
      "groupTotalCount": ""
    },
    "dma_srchGdsDtlSrchInfo": {
      "mvprpRletDvsCd": "00031R",            # 부동산 카테고리 고정
      "cortAuctnSrchCondCd": "0004601",
      "rprsAdongSdCd": "46",                 # bjd_code [0:2]
      "rprsAdongSggCd": "130",               # bjd_code [2:5]
      "rprsAdongEmdCd": "",                  # 옵션
      "pgmId": "PGJ151M01",
      "cortStDvs": "2",
      ...                                    # 그 외 미사용 빈값 필드
    }
  }

# 사건 상세 (1건)
POST https://www.courtauction.go.kr/pgj/pgj15A/selectAuctnCsSrchRslt.on
Body: { "dma_srchCsDtlInf": { "cortOfcCd": "B000513", "csNo": "20210130004007" } }

# 응답 12개 섹션:
#   dma_csBasInf (사건기본) / dlt_dspslGdsDspslObjctLst (물건) /
#   dlt_rletCsDspslObjctLst (목록) / dlt_rletCsGdsDtsDxdyInf (기일) /
#   dlt_rletCsIntrpsLst (당사자) / dlt_dstrtDemnLstprdDts (배당요구) /
#   dlt_csApalRaplDts (항고) / dlt_rletReltCsLst (관련사건) /
#   dlt_dpcnMrgTrnscsCsRlet (중복병합) / dlt_rletCsSugtExclBldLst (제시외건물)`,
  notes: `**검증 결과 (2026-05-04 실측, scripts/test_court_auction/)**:

- ✅ 인증/쿠키/세션 모두 불필요
- ✅ bjd_code 5자리 prefix 그대로 분리 ([0:2]/[2:5]) — 5개 표본 전부 매칭
- ✅ 페이지네이션 일관성 (1p/2p/3p totalCnt 동일, docid 중복 0)
- ✅ 페이지 사이즈 50 max (60+ HTTP 400 거부)
- ✅ 5초 간격 호출 시 차단 0
- ✅ 응답에 117개 필드 (감정가/최저가/유찰/매각기일/주소/면적/사진메타 등)
- ✅ 위경도 — wgs84Xcordi/Ycordi 는 정수만 (사용 X), xCordi/yCordi (TM) 는 정밀

**주의 사항**:

- ⚠️ wgs84Xcordi/Ycordi 가 모든 매물에서 정수 (예: "127", "34") — **사용 불가**
- ⚠️ TM 좌표 (xCordi/yCordi) 는 EPSG:5174 또는 5181 추정 — proj4js 변환 필요. 현재 어댑터는 bjd_master 동/리 좌표 사용 (정밀도는 마을 단위로 충분 — 의뢰자 의도)
- ⚠️ PNU 직접 필드 없음 — srchHjguDongCd(8) + 한글주소 + daepyoLotno 합성
- ⚠️ 진행상태 한글 직접 필드 없음 — yuchalCnt + maeGiil 휴리스틱 추정

**Vercel 배포 시 IP 정책**:

- vercel.json regions=["icn1"] 한국 리전 고정 → 법원경매 측 한국 IP 로 인식
- KEPCO 수집기 1년 무사고 선례 → 법원경매도 같은 안정성 기대
- 다만 데이터센터 IP 차단 정책이 있다면 차단 가능 — 배포 전 preview 검증 필수`,
  sampleRequest: {
    method: "POST",
    url: "https://www.courtauction.go.kr/pgj/pgjsearch/searchControllerMain.on",
    description:
      "목록 검색 — 전남 여수시 (46/130), pageSize 50, 1페이지. 인증 불필요. 응답 ~140KB / 50건.",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json;charset=UTF-8",
      Origin: "https://www.courtauction.go.kr",
      Referer:
        "https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml",
      "SC-Pgmid": "PGJ151F02",
      submissionid: "mf_wfm_mainFrame_sbm_selectGdsDtlSrch",
    },
  },
};
