/**
 * 법원경매정보재공 (courtauction.go.kr) 직접 호출 타입.
 *
 * 검증 (2026-05-04 실측):
 *   - 목록: POST /pgj/pgjsearch/searchControllerMain.on (pageSize 50 max, 인증 불필요)
 *   - 상세: POST /pgj/pgj15A/selectAuctnCsSrchRslt.on (cortOfcCd + csNo, 인증 불필요)
 *   - bjd_code 5자리 prefix 그대로 입력 가능 ([0:2]=adongSdCd, [2:5]=adongSggCd)
 *   - 응답에 PNU 직접 X — printSt(한글주소) + srchHjguDongCd(8) + daepyoLotno 합성 가능
 *   - wgs84Xcordi/Ycordi 는 정수만 (사용 불가) — xCordi/yCordi (TM) 변환 필요
 *
 * 어댑터 패턴:
 *   - 응답 raw → AuctionListItem (lib/hyphen/types.ts) 정규화
 *   - 향후 hyphen ↔ court 채널 swap 시 route.ts 한 줄만 변경
 *
 * 차단 회피:
 *   - 응답 후 500ms 직렬화 (모듈 전역)
 *   - WAF 키워드 (firewall / Detect time / 사용에 불편을 드려서) 감지 시 800ms+jitter 1회 재시도
 */

// ─── 호출 입력 ─────────────────────────────────────────────

/** 목록 검색 입력 — bjd_code 5자리 prefix 분리해서 사용. */
export interface CourtSearchParams {
  // ── 지역 ────────────────────────────────────────
  /** 시도 코드 2자리 (= bjd_code[0:2], 예: "46" 전남) */
  sdCd: string;
  /** 시군구 코드 3자리 (= bjd_code[2:5], 예: "130" 여수시) */
  sggCd: string;
  /** 읍면동 코드 3자리 (옵션, 보통 빈값 — 의뢰자 의도: 시군구까지만) */
  emdCd?: string;

  // ── 페이지네이션 ────────────────────────────────
  /** 페이지 번호 (1-base) */
  pageNo: number;
  /** 페이지 크기 (10/50 만 허용. 50 권장) */
  pageSize: number;
  /** 정렬 — 빈값 또는 "order by dspslDxdyYmd asc" 등 */
  orderBy?: string;
  /**
   * 페이지네이션 echo 파라미터 — 2페이지 이상 호출 시 1페이지 응답값 그대로 전달.
   * 1페이지 호출 시엔 빈값.
   */
  bfPageNo?: number | "";
  startRowNo?: number | "";
  totalCnt?: string;
  totalYn?: "Y" | "N";
  groupTotalCount?: number | "";

  // ── 용도 (대/중/소 단일 코드, 다중은 호출 분리) ─────
  /** 대분류 코드 (예: "10000"=토지 / "20000"=건물 / 빈값=전체) */
  lclCd?: string;
  /** 중분류 코드 (옵션) */
  mclCd?: string;
  /** 소분류 코드 (옵션) */
  sclCd?: string;

  // ── 매각기일 (YYYYMMDD) ─────────────────────────
  /** 매각기일 시작 (YYYYMMDD, 예: "20260504") */
  bidBgngYmd?: string;
  /** 매각기일 종료 (YYYYMMDD, 예: "20261104") */
  bidEndYmd?: string;

  // ── 가격 (원 단위 문자열, 빈문자열=전체) ─────────
  /** 감정평가액 최소 (원) */
  aeeEvlAmtMin?: string;
  /** 감정평가액 최대 (원) */
  aeeEvlAmtMax?: string;
  /** 최저매각가격 최소 (원) */
  lwsDspslPrcMin?: string;
  /** 최저매각가격 최대 (원) */
  lwsDspslPrcMax?: string;
  /** 최저매각가율 최소 (% 정수, 예: "30") */
  lwsDspslPrcRateMin?: string;
  /** 최저매각가율 최대 */
  lwsDspslPrcRateMax?: string;

  // ── 면적 (㎡, 토지+건물 통합) ───────────────────
  /** 면적 최소 (㎡, 정수 문자열) */
  objctArDtsMin?: string;
  /** 면적 최대 */
  objctArDtsMax?: string;

  // ── 유찰 ───────────────────────────────────────
  /** 유찰횟수 최소 */
  flbdNcntMin?: string;
  /** 유찰횟수 최대 */
  flbdNcntMax?: string;

  // ── 특이사항 ───────────────────────────────────
  /**
   * 특이사항 코드 콤마 join (예: "0004301,0004303").
   * special-cond.ts 의 buildSpecialCondParam 으로 생성.
   */
  rletDspslSpcCondCd?: string;
}

/** 상세 호출 입력 — 사건 1건. */
export interface CourtDetailParams {
  /** 법원 코드 (예: "B000513" 순천지원) */
  cortOfcCd: string;
  /** 사건번호 raw (예: "20210130004007") */
  csNo: string;
}

// ─── 목록 응답 raw ──────────────────────────────────────────

/**
 * 목록 응답의 매물 1건 — 117개 필드 중 우리가 사용할 것만.
 *
 * 검증된 사례:
 *   docid: "B0005132021013000400734"  (법원5+사건14+매물1+물건1+seq2)
 *   srnSaNo: "2021타경4007"           (사용자 형식)
 *   csNo: "20210130004007"            (raw 14자리)
 */
export interface CourtRawListItem {
  // ── 식별자 ──
  /** 매물 unique ID — 22~24자리. PK 후보. */
  docid: string;
  /** 법원 코드 (예: "B000513") */
  cortOfcCd?: string;
  /** boCd — docid 의 법원5자리 부분 ("B000513") */
  boCd: string;
  /** 사건번호 raw 14자리 ("20210130004007") */
  saNo: string;
  /** 사건번호 사용자 형식 ("2021타경4007") */
  srnSaNo: string;
  /** 매물 일련번호 (한 사건의 매물 N개 중 몇 번째) */
  maemulSer: string;
  /** 물건 일련번호 (한 매물의 물건 N개 중 몇 번째) */
  mokmulSer: string;

  // ── 사건 정보 ──
  /** 법원명 ("순천지원") */
  jiwonNm: string;
  /** 경매계 코드 (예: "1004") */
  jpDeptCd: string;
  /** 경매계 명 ("경매4계") */
  jpDeptNm: string;
  /** 경매계 전화 */
  tel: string;
  /** 진행상태 코드 (예: "0002100001") */
  jinstatCd: string;
  /** 매물 상태 코드 */
  mulStatcd: string;
  /** 진행 여부 ("Y"/"N") */
  mulJinYn: string;

  // ── 가격 ──
  /** 감정가 (원, 문자열) */
  gamevalAmt: string;
  /** 최저가 (원) */
  minmaePrice: string;
  /** 매각가 (낙찰 시) */
  maeAmt: string;
  /** 유찰 횟수 */
  yuchalCnt: string;
  /** 회차별 최저가 (1~4회) */
  notifyMinmaePrice1: string;
  notifyMinmaePrice2: string;
  notifyMinmaePrice3: string;
  notifyMinmaePrice4: string;
  /** 회차별 최저가 비율 */
  notifyMinmaePriceRate1: string;
  notifyMinmaePriceRate2: string;

  // ── 매각기일 ──
  /** 매각기일 YYYYMMDD ("20260511") */
  maeGiil: string;
  /** 매각결정기일 YYYYMMDD */
  maegyuljGiil: string;
  /** 매각기일 시각 1 HHMM ("1000") */
  maeHh1: string;
  maeHh2: string;
  maeHh3: string;
  maeHh4: string;
  /** 입찰장소 */
  maePlace: string;
  /** 매각기일 회차 누계 */
  maeGiilCnt: string;

  // ── 주소 ──
  /** 한글 풀주소 ("전라남도 여수시 돌산읍 금봉리 1231-3") */
  printSt: string;
  /** 시도 한글 */
  hjguSido: string;
  /** 시군구 한글 */
  hjguSigu: string;
  /** 동/면/읍 한글 */
  hjguDong: string;
  /** 리 한글 */
  hjguRd: string;
  /** 본번-부번 ("1231-3") */
  daepyoLotno: string;
  /** 검색용 시도 코드 2자리 */
  srchHjguSidoCd: string;
  /** 검색용 시군구 코드 5자리 (= bjd_master 5자리 prefix) */
  srchHjguSiguCd: string;
  /** 검색용 동 코드 8자리 (= bjd_master 앞 8자리) */
  srchHjguDongCd: string;
  /** 검색용 도로 코드 10자리 (= bjd_master 10자리. 리 없는 매물은 빈값/8자리) */
  srchHjguRdCd: string;
  /** 본번-부번 검색용 */
  srchHjguLotno: string;
  /** 주소 구분 ("A"=일반/"R"=도로/"S"=산?) */
  addrGbncd: string;

  // ── 분리 코드 (행안부 표준 분리 — srchHjguRdCd 빈값 fallback 용) ──
  /** 시도 코드 2자리 (예: "11" 서울) */
  daepyoSidoCd: string;
  /** 시군구 코드 3자리 (예: "680" 강남구) */
  daepyoSiguCd: string;
  /** 읍면동 코드 3자리 (예: "105" 도곡동) */
  daepyoDongCd: string;
  /** 리 코드 2자리 (예: "00" 리 없음, "01" 등) */
  daepyoRdCd: string;

  // ── 좌표 ──
  /** WGS84 위경도 — ⚠️ 정수만, 사용 불가 (예: "127", "34") */
  wgs84Xcordi: string;
  wgs84Ycordi: string;
  /** TM 직각좌표 X (정밀, 미터 단위) */
  xCordi: string;
  /** TM 직각좌표 Y */
  yCordi: string;
  /** 좌표 정밀도 레벨 */
  cordiLvl: string;

  // ── 매물 ──
  /** 매각 용도명 ("다세대"/"아파트"/"전답"/"근린시설" 등) */
  dspslUsgNm: string;
  /** 매물 용도 코드 */
  maemulUtilCd: string;
  /** 면적 표시 ("4109㎡") */
  areaList: string;
  /** 지목 ("전") */
  jimokList: string;
  /** 건물 표시 ("철근콘크리트구조 15.93㎡") */
  buldList: string;
  /** 건물명 */
  buldNm: string;
  /** 면적 최소/최대 */
  minArea: string;
  maxArea: string;
  /** 변환된 한글 주소 ("[토지 전 4109㎡]") */
  convAddr: string;
  /** 특이사항/비고 */
  mulBigo: string;
  /** 분류 코드 3단계 */
  lclsUtilCd: string;
  mclsUtilCd: string;
  sclsUtilCd: string;

  // ── 중복/관련 사건 ──
  /** 중복사건 번호 ("2023타경2852") */
  dupSaNo: string;
  /** 병합사건 번호 */
  byungSaNo: string;
  /** 인쇄용 사건번호 (HTML <br/> 포함 가능) */
  printCsNo: string;

  // ── 그룹/그 외 ──
  /** 그룹 매물 일련 — 한 사건의 매물 묶기용 */
  groupmaemulser: string;
  bocdsano: string;
  inqCnt: string;
  /** 관심물건 등록 수 */
  gwansMulRegCnt: string;
  /** 입찰 구분 코드 */
  ipchalGbncd: string;
  /** 정지/사건 구분 코드 */
  spJogCd: string;
  mokGbncd: string;
  jongCd: string;
  stopsaGbncd: string;

  // 기타 응답 필드는 [key: string]: unknown 으로 흡수
  [key: string]: unknown;
}

/** 목록 응답 본체. */
export interface CourtListResponse {
  status: number;
  message: string;
  timestamp: number;
  data: {
    ipcheck: boolean;
    dma_pageInfo: {
      pageNo: number;
      pageSize: number | string;
      bfPageNo: number | string;
      startRowNo: number | string;
      totalCnt: string;
      totalYn?: "Y" | "N";
      groupTotalCount?: number;
    };
    /** 매물 N건 */
    dlt_srchResult: CourtRawListItem[];
  };
}

// ─── 상세 응답 raw (12개 섹션) ─────────────────────────────

/**
 * 상세 응답 — 12개 섹션 그대로 보존.
 *
 * 화면 영역 매핑:
 *   - 사건기본내역: dma_csBasInf
 *   - 물건내역: dlt_dspslGdsDspslObjctLst
 *   - 목록내역: dlt_rletCsDspslObjctLst
 *   - 기일내역: dlt_rletCsGdsDtsDxdyInf
 *   - 당사자내역: dlt_rletCsIntrpsLst
 *   - 배당요구종기내역: dlt_dstrtDemnLstprdDts
 *   - 항고내역: dlt_csApalRaplDts
 *   - 관련사건내역: dlt_rletReltCsLst
 *   - 중복/병합/이송: dlt_dpcnMrgTrnscsCsRlet
 *   - 제시외건물: dlt_rletCsSugtExclBldLst
 */
export interface CourtRawDetailItem {
  /** 사건 기본 정보 */
  dma_csBasInf: {
    cortOfcCd: string;
    cortOfcNm: string; // "광주지방법원"
    cortSptNm: string; // "순천지원"
    csNo: string;
    csNm: string; // "부동산임의경매"
    csRcptYmd: string;
    csCmdcYmd: string;
    /** 청구금액 */
    clmAmt: number;
    rletApalYn: string;
    auctnSuspStatCd: string;
    csProgStatCd: string;
    auctnDpcnMrgDvsCd: string;
    mvprpRletDvsCd: string;
    jdbnCd: string;
    cortAuctnJdbnNm: string; // "경매4계"
    jdbnTelno: string;
    execrCsTelno: string;
    cortTypCd: string;
    /** 사용자 표시 사건번호 ("2021타경4007") */
    userCsNo: string;
    [key: string]: unknown;
  };

  /** 매각 물건 (한 사건의 N개 토지/건물) */
  dlt_dspslGdsDspslObjctLst: Array<{
    cortOfcCd: string;
    csNo: string;
    dspslGdsSeq: number;
    auctnGdsUsgCd: string;
    /** 감정평가액 */
    aeeEvlAmt: number;
    /** 매각가 */
    dspslAmt: number;
    /** 첫 회차 최저가 */
    fstPbancLwsDspslPrc: number;
    /** 매각기일 YYYYMMDD */
    dspslDxdyYmd: string;
    /** 첫 회차 시각 */
    fstDspslHm: string;
    /** 시도/시군구/읍면동/리 코드 */
    rprsAdongSdCd: string;
    rprsAdongSggCd: string;
    rprsAdongEmdCd: string;
    rprsAdongRiCd: string;
    /** 본번-부번 ("산566", "1231-3") */
    rprsLtnoAddr: string;
    /** 한글 분리 */
    adongSdNm: string;
    adongSggNm: string;
    adongEmdNm: string;
    adongRiNm: string;
    /** 한글 풀주소 ("전라남도 여수시 돌산읍 금봉리 산566 ") */
    userSt: string;
    /** 주소 구분 ("A"=일반/"S"=산?) */
    addrTypCd: string;
    /** 매물 분류 3단계 */
    lclDspslGdsLstUsgCd: string;
    mclDspslGdsLstUsgCd: string;
    sclDspslGdsLstUsgCd: string;
    /** 문서 ID — 상세 문서 다운로드 키 (사용 안 함) */
    dspslGdsSpcfcEcdocId: string;
    dspslDxdyPbancEcdocId: string;
    /** 공고 시작일 YYYYMMDD */
    pstgBgngYmd: string | null;
    /** 공고 종료일 YYYYMMDD */
    pstgEndYmd: string | null;
    /** 매각기일 회차 누계 (= 유찰수) */
    dspslDxdyDnum: number;
    /** 입찰보증금 비율 % (보통 10) */
    prchDposRate: number;
    /**
     * 매각물건 내 객체(토지/건물) 순번 — 같은 dspslGdsSeq 안에서 1, 2, 3...
     * dspslGdsSeq 는 매각물건 그룹(일괄매각 시 같은 값) 이고,
     * 진짜 물건별 순번은 이 dspslObjctSeq 입니다.
     */
    dspslObjctSeq: number;
    /**
     * 토지/건물 구분 코드:
     *   - "01" = 토지
     *   - "02" = 건물
     *   - "03" = 집합건물 (구분소유)
     */
    auctnLstDvsCd: string;
    /** 건물명 (있으면 "주1동" 등, 토지면 null) */
    bldNm: string | null;
    [key: string]: unknown;
  }>;

  /** 목록 — 매각 물건의 토지/건물 분류 */
  dlt_rletCsDspslObjctLst: Array<{
    cortOfcCd: string;
    csNo: string;
    dspslObjctSeq: number;
    /** "토지" / "건물" / "구분소유" 등 */
    auctnLstNm: string;
    rprsAdongSdCd: string;
    rprsAdongSggCd: string;
    rprsAdongEmdCd: string;
    rprsAdongRiCd: string;
    rprsLtnoAddr: string;
    userSt: string;
    /** 종국명 ("미종국"/"매각" 등) */
    ultmtNm: string;
    [key: string]: unknown;
  }>;

  /** 기일 — 회차별 매각기일 이력 */
  dlt_rletCsGdsDtsDxdyInf: Array<{
    cortOfcCd: string;
    csNo: string;
    dspslGdsSeq: number;
    /** 기일 종류 (01=매각기일) */
    auctnDxdyKndCd: string;
    /** YYYYMMDD */
    dxdyYmd: string;
    /** HHMM */
    dxdyHm: string;
    dxdyPlcNm: string;
    /** 결과 코드 (001=진행/002=유찰/003=매각) */
    auctnDxdyRsltCd: string;
    [key: string]: unknown;
  }>;

  /** 당사자 — 채권자/채무자/관계인 */
  dlt_rletCsIntrpsLst: Array<{
    cortOfcCd: string;
    csNo: string;
    auctnIntrpsDvsCd: string;
    intrpsSeq: number;
    /** 이름 (예: "허OO" 마스킹됨) */
    intrpsNm: string;
    /** 구분 한글 ("채권자"/"채무자"/"소유자") */
    auctnIntrpsDvsNm: string;
    [key: string]: unknown;
  }>;

  /** 배당요구종기 */
  dlt_dstrtDemnLstprdDts: Array<{
    cortOfcCd: string;
    csNo: string;
    dspslObjctSeq: number;
    auctnLstDvsCd: string;
    /** YYYYMMDD */
    dstrtDemnLstprdYmd: string;
    /** 공고일 */
    dstrtDemnLstprdPbancYmd: string;
    [key: string]: unknown;
  }>;

  /** 항고 (보통 0건) */
  dlt_csApalRaplDts: unknown[];

  /** 관련 사건 */
  dlt_rletReltCsLst: Array<{
    reltCsCortOfcCd: string;
    reltCsNo: string;
    reltCsDvsCd: string;
    cortOfcNm: string;
    /** 관련사건 사용자형식 ("2021타기579") */
    userReltCsNo: string;
    /** 구분 ("개시결정이의" 등) */
    reltCsDvsNm: string;
    [key: string]: unknown;
  }>;

  /** 중복/병합/이송 */
  dlt_dpcnMrgTrnscsCsRlet: Array<{
    reltCortOfcCd: string;
    reltCsNo: string;
    reltCsDvsCd: string;
    csNo: string;
    /** 사용자 형식 ("2023타경2852") */
    userReltCsNo: string;
    [key: string]: unknown;
  }>;

  /** 제시외 건물 (보통 0건) */
  dlt_rletCsSugtExclBldLst: unknown[];

  /** 송달 파라미터 */
  dma_dlvrfDtsParam?: Record<string, unknown>;

  [key: string]: unknown;
}

export interface CourtDetailResponse {
  status: number;
  message: string;
  timestamp: number;
  data: CourtRawDetailItem & { ipcheck: boolean };
}

// ─── 호출 결과 wrapper ──────────────────────────────────────

/** API 상태 — UI 배너용 (hyphen 의 HyphenApiStatus 미러). */
export type CourtApiStatus =
  | "ok"
  | "empty"
  /** WAF 차단 감지 */
  | "blocked"
  /** 일시 장애 */
  | "unavailable";

export interface CourtListPageResult {
  apiStatus: CourtApiStatus;
  errMsg?: string;
  items: CourtRawListItem[];
  pageNo: number;
  pageSize: number;
  totalCnt: number;
  groupTotalCount: number;
  hasMore: boolean;
}
