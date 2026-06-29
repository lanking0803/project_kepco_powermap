---
name: 특허 출원 중 워터마크 (임시 표시)
description: 지도 화면 "특허 출원 중 · Patent Pending" 사선 워터마크. 현재 임시 비활성화 중 — 의뢰자가 "다시 넣어줘" 하면 TEMP_DISABLED 줄만 삭제하면 원복.
type: project
---
## ⚠️ 현재 임시 비활성화 중 (2026-06-29)

의뢰자 요청으로 워터마크를 **임시로 내린 상태** (기간 미정, "다시 넣어달라"고 하면 복구).

- 방법: `web/components/map/PatentWatermark.tsx` 함수 첫 줄 `if (TEMP_DISABLED) return null;` + 파일 상단 `const TEMP_DISABLED = true;`
- 커밋: `fdc8fd6` (2026-06-29 푸시 → Vercel 배포 반영). 로컬·운영 양쪽 적용됨.

**다시 켜는(원복) 방법 — 의뢰자가 "워터마크 다시 넣어줘" 하면:**
1. `web/components/map/PatentWatermark.tsx` 에서 `const TEMP_DISABLED = true;` **줄만 삭제** (함수 안 `if (TEMP_DISABLED) return null;` 도 같이 삭제하면 더 깔끔)
2. 커밋 + 푸시 → Vercel 자동 배포로 운영·로컬 양쪽 원복
3. (또는 `git revert fdc8fd6` 한 방으로도 동일)
4. 원복 후 이 "임시 비활성화 중" 섹션 삭제 + description 원복

> 모양·위치·투명도 등은 코드가 그대로라 원복 시 100% 동일하게 복구됨.

## 현황 (2026-04-15 추가)

지도 화면 전체에 "특허 출원 중 · Patent Pending" 사선(-30°) 반복 워터마크 표시.

- 파일: `web/components/map/PatentWatermark.tsx`
- 연결: `web/components/map/MapClient.tsx` 루트 div 최하단에 `<PatentWatermark />`
- 투명도: 10% (rgba(0,0,0,0.10))
- 관리자 페이지(`app/admin/*`)는 적용 안 됨 (AdminNav 사용하기 때문)

**Why:** 의뢰자가 특허 출원 진행 중이라 등록 완료 전까지 권리 고지 목적. 등록 후 삭제 예정.

**How to apply:** 특허 등록 완료 소식이 들리면 아래 방법으로 제거.

## 동작 원리 (기능 영향 0인 이유)

- `pointer-events: none` — 마우스/터치 이벤트 모두 투과 (지도 드래그, 마커 클릭, 버튼 클릭 전부 정상)
- `user-select: none` — 텍스트 드래그 선택 불가
- `overflow: hidden` — 회전된 텍스트가 화면 밖으로 안 넘침
- `z-index: 45` — 지도 UI 위, 모달(z-100) 아래 (모달 뜨면 워터마크 가려짐)
- `position: absolute inset-0` — MapClient 루트 div 기준 전체 화면 덮음

## 제거 방법

### A. 환경변수 토글 (즉시, 권장)
```
# .env.local 또는 Vercel 환경변수
NEXT_PUBLIC_PATENT_PENDING=false
```
재배포만 하면 워터마크 안 보임. 코드 수정 불필요.

### B. 코드 완전 제거
1. `web/components/map/MapClient.tsx` 에서 `PatentWatermark` import 삭제
2. 같은 파일에서 `<PatentWatermark />` 렌더 라인 삭제
3. `web/components/map/PatentWatermark.tsx` 파일 삭제
4. `docs/개발계획.md` §4-2 "특허 출원 중 워터마크" 섹션 삭제
5. 이 메모 파일 삭제 + MEMORY.md 해당 라인 삭제

## 관련 문서
- `docs/개발계획.md` §4-2
- `web/components/map/PatentWatermark.tsx` 상단 주석
