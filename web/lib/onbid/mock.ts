/**
 * ⚠️ 임시 파일 — UI 개발용 Mock 데이터.
 *
 * 백엔드 (web/lib/onbid/list.ts + /api/onbid/search) 완성되면
 *   → 이 파일 삭제 + import 한 곳들을 실 fetch 호출로 교체.
 * 절대 production 빌드에 포함되면 안 됨.
 *
 * Mock 매물 8건:
 *   - 5종 카테고리 골고루 (토지/유리온실/축사/창고/건물50+)
 *   - D-day 다양 (D-3 이내 2건, D-30, D-60+)
 *   - 시도 다양 (전남/경북/서울/경기/강원)
 *   - 사진 있는 것 / 없는 것
 *
 * 좌표는 임의로 박아둔 동 단위 좌표 (실제는 bjd_master JOIN).
 */

import type { OnbidListItem, OurCategory } from "./types";

const today = new Date();
const fmt = (d: Date) =>
  d.getFullYear().toString() +
  String(d.getMonth() + 1).padStart(2, "0") +
  String(d.getDate()).padStart(2, "0") +
  "1700";
const addDays = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return d;
};

interface MockSeed {
  cltrMngNo: string;
  cltrNm: string;
  ltnoPnu: string;
  sd: string;
  sgg: string;
  emd: string;
  category: OurCategory;
  sclsCtgrNm: string;
  sclsCtgrId: string;
  apslEvlAmt: number;
  lowstBidPrc: number;
  daysLeft: number;
  landSqms: number | null;
  bldSqms: number | null;
  usbdNft: number;
  lat: number;
  lng: number;
}

const SEEDS: MockSeed[] = [
  // D-3 이내 임박 (강조 표시 테스트용)
  {
    cltrMngNo: "2024-1100-084555",
    cltrNm: "전라남도 영암군 시종면 봉소리 7  (토지),  9 (토지, 건물)",
    ltnoPnu: "4683034023000070000",
    sd: "전라남도",
    sgg: "영암군",
    emd: "시종면",
    category: "토지",
    sclsCtgrNm: "단독주택",
    sclsCtgrId: "10401",
    apslEvlAmt: 152_944_000,
    lowstBidPrc: 2_838_000,
    daysLeft: 2,
    landSqms: 1130,
    bldSqms: 6.94,
    usbdNft: 5,
    lat: 34.7283,
    lng: 126.6992,
  },
  {
    cltrMngNo: "2024-2200-091111",
    cltrNm: "경상북도 경산시 남천면 신석리 산154",
    ltnoPnu: "4729037025101540000",
    sd: "경상북도",
    sgg: "경산시",
    emd: "남천면",
    category: "토지",
    sclsCtgrNm: "임야",
    sclsCtgrId: "10501",
    apslEvlAmt: 89_500_000,
    lowstBidPrc: 35_800_000,
    daysLeft: 3,
    landSqms: 4521,
    bldSqms: null,
    usbdNft: 2,
    lat: 35.7894,
    lng: 128.7521,
  },
  // 일반 (D-7~D-30)
  {
    cltrMngNo: "2025-3300-007722",
    cltrNm: "경기도 화성시 양감면 송산리 산23-1 (유리온실)",
    ltnoPnu: "4159033030000231000",
    sd: "경기도",
    sgg: "화성시",
    emd: "양감면",
    category: "유리온실",
    sclsCtgrNm: "동·식물관련시설",
    sclsCtgrId: "12100",
    apslEvlAmt: 285_000_000,
    lowstBidPrc: 199_500_000,
    daysLeft: 12,
    landSqms: 3120,
    bldSqms: 1856,
    usbdNft: 1,
    lat: 37.0421,
    lng: 126.9783,
  },
  {
    cltrMngNo: "2025-4400-013300",
    cltrNm: "충청남도 홍성군 광천읍 옹암리 245-3 (축사)",
    ltnoPnu: "4480025033002450003",
    sd: "충청남도",
    sgg: "홍성군",
    emd: "광천읍",
    category: "축사",
    sclsCtgrNm: "동·식물관련시설",
    sclsCtgrId: "12100",
    apslEvlAmt: 412_000_000,
    lowstBidPrc: 247_200_000,
    daysLeft: 21,
    landSqms: 5840,
    bldSqms: 2245,
    usbdNft: 0,
    lat: 36.5512,
    lng: 126.5938,
  },
  {
    cltrMngNo: "2025-5500-022345",
    cltrNm: "경상남도 김해시 진례면 시례리 178-12 (창고시설)",
    ltnoPnu: "4825035022001780012",
    sd: "경상남도",
    sgg: "김해시",
    emd: "진례면",
    category: "창고",
    sclsCtgrNm: "창고시설",
    sclsCtgrId: "10402",
    apslEvlAmt: 567_000_000,
    lowstBidPrc: 396_900_000,
    daysLeft: 35,
    landSqms: 2340,
    bldSqms: 1687,
    usbdNft: 1,
    lat: 35.2541,
    lng: 128.7583,
  },
  {
    cltrMngNo: "2025-6600-033456",
    cltrNm: "강원도 원주시 부론면 흥호리 산45 (제2종근린생활시설)",
    ltnoPnu: "5113034028000451000",
    sd: "강원도",
    sgg: "원주시",
    emd: "부론면",
    category: "건물50plus",
    sclsCtgrNm: "제2종근린생활시설",
    sclsCtgrId: "10202",
    apslEvlAmt: 723_000_000,
    lowstBidPrc: 506_100_000,
    daysLeft: 48,
    landSqms: 1280,
    bldSqms: 198,
    usbdNft: 0,
    lat: 37.2853,
    lng: 127.9614,
  },
  // 같은 동에 매물 2건 (클러스터링 테스트)
  {
    cltrMngNo: "2025-7700-044567",
    cltrNm: "전라남도 영암군 시종면 봉소리 88-2 (토지)",
    ltnoPnu: "4683034023000880002",
    sd: "전라남도",
    sgg: "영암군",
    emd: "시종면",
    category: "토지",
    sclsCtgrNm: "전",
    sclsCtgrId: "10502",
    apslEvlAmt: 67_500_000,
    lowstBidPrc: 47_250_000,
    daysLeft: 18,
    landSqms: 2150,
    bldSqms: null,
    usbdNft: 1,
    lat: 34.7283,
    lng: 126.6992,
  },
  // 마감 임박 (D-1)
  {
    cltrMngNo: "2025-8800-055678",
    cltrNm: "서울특별시 노원구 상계동 1234-5 (창고)",
    ltnoPnu: "1135010100012340005",
    sd: "서울특별시",
    sgg: "노원구",
    emd: "상계동",
    category: "창고",
    sclsCtgrNm: "창고시설",
    sclsCtgrId: "10402",
    apslEvlAmt: 1_245_000_000,
    lowstBidPrc: 871_500_000,
    daysLeft: 1,
    landSqms: 564,
    bldSqms: 412,
    usbdNft: 3,
    lat: 37.6534,
    lng: 127.0688,
  },
];

export const MOCK_ITEMS: OnbidListItem[] = SEEDS.map((s, i) => {
  const endDate = addDays(s.daysLeft);
  const startDate = addDays(s.daysLeft - 30);
  return {
    cltrMngNo: s.cltrMngNo,
    pbctCdtnNo: 5_900_000 + i,
    onbidCltrno: 1_600_000 + i * 1000,
    onbidPbancNo: 880_000 + i * 100,
    pbctNo: 10_000_000 + i * 100,
    onbidCltrNm: s.cltrNm,
    ltnoPnu: s.ltnoPnu,
    rdnmPnu: s.ltnoPnu + "00000",
    lctnSdnm: s.sd,
    lctnSggnm: s.sgg,
    lctnEmdNm: s.emd,
    cltrUsgLclsCtgrId: "10000",
    cltrUsgMclsCtgrId: s.sclsCtgrId.slice(0, 3) + "00",
    cltrUsgSclsCtgrId: s.sclsCtgrId,
    cltrUsgSclsCtgrNm: s.sclsCtgrNm,
    prptDivCd: "0007",
    prptDivNm: "압류재산",
    apslEvlAmt: s.apslEvlAmt,
    lowstBidPrcIndctCont: s.lowstBidPrc.toLocaleString(),
    cltrBidBgngDt: fmt(startDate).replace("1700", "1000"),
    cltrBidEndDt: fmt(endDate),
    landSqms: s.landSqms,
    bldSqms: s.bldSqms,
    usbdNft: s.usbdNft,
    // Enriched
    ourCategory: s.category,
    lat: s.lat,
    lng: s.lng,
    lowstBidPrc: s.lowstBidPrc,
    discountRatio: 1 - s.lowstBidPrc / s.apslEvlAmt,
    daysLeft: s.daysLeft,
    isUrgent: s.daysLeft <= 3 && s.daysLeft >= 0,
  };
});
