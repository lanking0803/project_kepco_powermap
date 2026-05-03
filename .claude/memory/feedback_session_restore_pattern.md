---
name: 검색 패널 sessionStorage 복원 — 부모 onResults 호출 필수
description: 모드별 검색 패널 마운트 시 복원된 results 를 부모에 흘리지 않으면 새로고침/모드 전환 후 지도 마커 0건 회귀
type: feedback
---

# sessionStorage 복원 패턴 — 부모 콜백 호출 누락 사고

새 검색 모드(공매·경매·시설 등) 패널 추가할 때 **마운트 시점에 복원된 results 를 부모(MapClient) 의 setItems 로 흘리지 않으면**, 사용자가 모드 전환/새로고침 후 마커가 0건으로 회귀.

## 패턴 (반드시 지킬 것)

```typescript
// {Mode}SearchPanel.tsx
const persisted = typeof window !== "undefined"
  ? loadModeState<{Mode}PersistedState>(MODE_ID)
  : null;

const [results, setResults] = useState(persisted?.results ?? []);

// ★ 마운트 시 — 복원된 결과를 부모(MapClient)로 올려서 지도 마커도 즉시 복원
const onResultsRef = useRef(onResults);
onResultsRef.current = onResults;
useEffect(() => {
  if (persisted && persisted.results.length > 0) {
    onResultsRef.current?.(persisted.results);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

## 사고 복기 (2026-05-03)

D2 단계에서 AuctionSearchPanel 작성 시 `onResults: _onResults` 언더스코어 prefix 로 두고 "현재 단계는 호출되지 않음" 주석으로 미루어 둠. D3 단계(지도 마커)에서 정리 누락 → 검색 직후엔 우연히 동작했지만 **새로고침/모드 전환 후 sessionStorage 에서 results 가 부모로 안 흘러가** 마커 0건.

OnbidSearchPanel 은 패턴 정확히 따르고 있어서 회귀 없었음. 패턴 통일 필요.

## Why

- sessionStorage 는 검색 입력값 + 결과 둘 다 보존
- 패널은 자체 state 에서 results 복원 → 결과 카드는 보임
- **하지만 지도 마커 데이터는 부모(MapClient) state 라 onResults 콜백이 호출 돼야 흘러감**
- 호출 시점은 마운트 1회 (deps=[]) — 매 렌더 호출하면 무한 루프

## How to apply

- 새 모드 패널 작성 시 OnbidSearchPanel 의 `useEffect(() => { ...persisted.results... }, [])` 블록을 **반드시 미러**
- 언더스코어 prefix (`onResults: _onResults`) 로 미루는 흔적이 있으면 정리 단계에서 활성화 확인
- 검증 시나리오: 검색 → **모드 전환 → 다시 돌아옴** → 마커 보이는지 / 새로고침 → 마커 보이는지

## 관련 사고

- `_onResults` 같은 언더스코어 prefix = "지금은 안 쓴다" 의도지만 D3 단계에 정리 안 되면 영구 미연결
- Reset 함수에서도 `onResults?.([])` 호출해서 부모 state 도 비워야 마커 사라짐
