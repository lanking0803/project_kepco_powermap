---
name: Vercel region 서울(icn1) 고정 + preferredRegion 함정
description: Vercel 기본 region(iad1, 미국)에서 한국 외부 API 호출 시 fetch failed. web/vercel.json 으로 프로젝트 전역 icn1 고정. preferredRegion 은 Edge runtime 전용이라 Node 에선 무시됨.
type: reference
---

## 핵심
- **현재 상태**: [`web/vercel.json`](../../web/vercel.json) = `{"regions":["icn1"]}`. 프로젝트 모든 함수가 서울 region 에서 실행.
- **이유**: 한국 정부 API (VWorld / KEPCO / 캠코 / 법제처 / data.go.kr) 는 미국 IP 에서 호출 시 connection 단계에서 거절. dev(localhost) 한국 IP 는 정상 → Vercel iad1 만 깨지는 사일런트 prod-only 버그.
- **증상 (2026-04-30 VWorld 사례)**: 지번 클릭 시 빈 팝업. `/api/parcel/by-pnu` 응답 `{ok:true, jibun:null, geometry:null}`. 진단 로그로 `region=iad1 elapsed=572ms err=TypeError:fetch failed` 확정 후 vercel.json 추가로 즉시 해결.

## 함정
- **`export const preferredRegion = "icn1"` 은 Vercel Edge runtime 전용**. Node runtime 라우트(우리 라우트 전부 Node)에서는 Vercel 이 **에러 없이 silent ignore**. Next.js 공식 문서 명시: "regions are only supported if export const runtime = 'edge' is set".
- 즉 라우트별 `preferredRegion` 한 줄 추가는 헛수고. **`vercel.json` 의 `regions` 만이 Node runtime 에 유효**.

## 신규 한국 외부 API 추가 시
- vercel.json 이 프로젝트 전역이라 별도 작업 0. 라우트 추가만 하면 자동으로 icn1 에서 실행됨.
- 진단 시 의심 가설: 응답이 silent fail (null/빈 배열) + dev 정상 + prod 만 깨짐 → region 부터 의심.

## 진단 패턴 (재발 시)
- `process.env.VERCEL_REGION` 을 로그에 찍으면 함수 실행 region 확정 가능 (`x-vercel-id` 헤더의 iad1 등은 edge POP 일 뿐 함수 실행 region 과 다름).
- HTTP non-200 응답은 `await res.text().then(t => t.slice(0,200))` 로 본문 프리뷰 — VWorld 등 일부 한국 API 는 거절 사유를 평문으로 반환.

## 부수효과
- KEPCO/캠코/법제처/data.go.kr 호출도 함께 빨라짐 (한↔한 라우팅).
- Supabase region = Seoul (ap-northeast-2) 라 DB 호출도 같이 빨라짐 (이전에는 미↔한 cross-region).
- Vercel Hobby plan 도 단일 region 지정 가능 (multi-region 만 Pro 이상).
