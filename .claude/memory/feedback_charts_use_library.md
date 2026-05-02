---
name: 차트는 라이브러리 사용 (SVG 직접 그리기 금지)
description: 차트 필요 시 Recharts 우선 사용. SVG path 직접 작성 시 점 찌그러짐/툴팁/보간 등 기본 기능 재구현으로 유지보수 어려움.
type: feedback
---

# 차트는 라이브러리로 그린다

## 규칙
지표/그래프/차트 표현이 필요하면 **Recharts 우선 사용**. SVG path/circle/rect 직접 작성 금지.

## Why
2026-05-02 가격 탭 PriceTrendChart 작업 시 SVG 직접 그렸다가:
- `viewBox` + `preserveAspectRatio="none"` 조합으로 가로/세로 다른 비율 늘어나며 **점이 타원으로 찌그러짐**
- Tooltip 위치 보정 (좌/우 끝 잘림 회피) 수동 처리
- 라인 끊김/dotted 보간 path 분기 수동 처리
- 듀얼 Y축 좌표 변환 헬퍼 직접 작성
- 결과: 290줄짜리 `<svg>` 코드. 의뢰자 "차트그리는 모듈들 많잖아" 지적
- Recharts 로 교체 후 145줄. 위 모든 문제 라이브러리가 처리.

## How to apply
- 신규 차트: `recharts` 의 `<ComposedChart>` / `<LineChart>` / `<BarChart>` 등 사용
- 라인+막대+영역 동시 = `<ComposedChart>` 안에 `<Line>`, `<Bar>`, `<Area>` 조합
- 듀얼 Y축 = `<YAxis yAxisId="..." />` 두 개 (orientation="left"/"right")
- Tooltip 커스텀 = `<Tooltip content={<MyTooltip />} />` 로 내용만 React 컴포넌트로
- ResponsiveContainer 부모는 명시적 width/height 또는 `style={{ width: "100%", height: 176 }}` — flex 부모에서 -1 으로 찌부러지는 것 방지

## 예외
- 단일 작은 sparkline (점선 한 줄, 인터랙션 없음): 직접 SVG 도 OK
- 유저 인터랙션/툴팁/축 라벨/포맷팅 필요하면 무조건 라이브러리

## 관련 파일
- [web/components/map/parcel/PriceTrendChart.tsx](../../web/components/map/parcel/PriceTrendChart.tsx)
- 의존성: web/package.json `recharts ^3.8.1`