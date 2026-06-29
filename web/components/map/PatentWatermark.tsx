"use client";

/**
 * 특허 출원 중 워터마크 (사선 타일 패턴)
 *
 * ⚠️ 특허 등록 완료 시 제거 방법 (택 1):
 *   방법 A (권장) — 환경변수 끄기:
 *     .env.local 또는 Vercel 환경변수에서
 *     NEXT_PUBLIC_PATENT_PENDING=false
 *     (재배포만 하면 됨. 코드 수정 불필요)
 *
 *   방법 B — 코드 완전 제거:
 *     1) MapClient.tsx 에서 PatentWatermark import 삭제
 *     2) <PatentWatermark /> 렌더 라인 삭제
 *     3) 이 파일(PatentWatermark.tsx) 삭제
 *
 * 관련 문서: docs/개발계획.md "특허 출원 중 워터마크" 섹션 참고.
 *
 * 동작 특징:
 *   - pointer-events: none → 지도 드래그/클릭/줌 모두 투과 (기능 영향 0)
 *   - user-select: none  → 텍스트 드래그 선택 방지
 *   - overflow: hidden   → 회전된 텍스트가 화면 밖으로 안 넘침
 *   - position: fixed    → viewport 기준. 스카이뷰 타일(내부 stacking context)
 *                          위에도 올라오도록 필수
 *   - z-index: 45        → 지도 UI 위, 모달(z-100) 아래
 */

// [임시] 워터마크 7일간 비활성화 — 2026-07-06 원복 예정
//   원복: 아래 TEMP_DISABLED 줄만 삭제하면 원래대로 복구됨 (다른 코드 변경 없음)
const TEMP_DISABLED = true;

const PATENT_PENDING_ENABLED =
  process.env.NEXT_PUBLIC_PATENT_PENDING !== "false";

export default function PatentWatermark() {
  if (TEMP_DISABLED) return null;
  if (!PATENT_PENDING_ENABLED) return null;

  // 반복 텍스트 — 한 줄당 여러 번 반복해야 회전 후에도 화면 전체 덮음
  const lineText = "특허 출원 중 · Patent Pending  ";
  const repeated = lineText.repeat(8);

  // 세로 라인 개수 — 화면 높이 대비 넉넉히
  const lines = Array.from({ length: 14 });

  return (
    <div
      aria-hidden
      className="pointer-events-none select-none fixed inset-0 overflow-hidden"
      style={{ zIndex: 45 }}
    >
      <div
        className="absolute"
        style={{
          top: "-20%",
          left: "-20%",
          width: "140%",
          height: "140%",
          transform: "rotate(-30deg)",
          transformOrigin: "center",
        }}
      >
        {lines.map((_, i) => (
          <div
            key={i}
            className="whitespace-nowrap font-bold tracking-wider"
            style={{
              // 밝은 배경(지도)과 어두운 배경(스카이뷰) 모두에서 보이도록
              // 흰색 글자 + 검정 외곽선 조합 (paint-order 로 외곽선이 글자 뒤로)
              color: "rgba(255, 255, 255, 0.14)",
              WebkitTextStroke: "1px rgba(0, 0, 0, 0.12)",
              paintOrder: "stroke fill",
              fontSize: "clamp(18px, 2.2vw, 28px)",
              lineHeight: "1",
              padding: "28px 0",
            }}
          >
            {repeated}
          </div>
        ))}
      </div>
    </div>
  );
}
