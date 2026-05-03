---
name: 줌 변경이 주된 사용 패턴이면 level-skip 가드는 무의미
description: rebuild skip 가드의 키에 level 이 들어가면 줌마다 무조건 통과 — 코드 복잡도만 늘어나고 효과 0
type: feedback
---

KakaoMap 마커 rebuild 최적화 시도 (2026-05-03) 결과 기록.

`if (key === lastKey) return;` 형태의 skip 가드를 도입할 때, **키 구성요소가
사용 패턴에서 자주 변하면 가드는 거의 발동하지 않는다**.

**Why:** 이 앱의 주된 사용 패턴은 줌인/줌아웃. key 에 `level` 이 들어가면
매번 다른 키가 되어 100% 통과 → skip 발동률 0 + 키 계산/비교 비용만 추가.
실측 결과 Step 1A(-63%) 후 1B+1C 추가 적용 시 오히려 +79% 악화.

**How to apply:**
- skip 가드를 도입하기 전, **사용자가 실제로 변경하지 않는 변수**가 키에 있는지 확인.
  예: 같은 줌에서 패닝만 반복할 때만 의미 있음.
- 줌이 자주 바뀌는 앱이면 level 기반 skip 대신 다른 최적화 (마커 객체 풀링 = Tier 2,
  줌 레벨별 데이터 단위 전환 = `project_zoom_level_optimization.md`) 을 우선.
- 진단할 때 가설만으로 skip 가드 추가하지 말고, **어떤 시나리오에서 lastKey 가
  실제로 같은지** 머릿속으로 시뮬레이션 먼저.

**관련 커밋:**
- `86ef189` Step 1A (성공: idle 리스너 4→1 통합. INP 2,498→313ms)
- 1B+1C 는 적용했다가 즉시 원복 (효과 음수)
