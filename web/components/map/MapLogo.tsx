"use client";

/**
 * 지도 좌측 상단 SUNMAP 로고 칩
 *
 * 의뢰자(안홍열 대표) 요청 (2026-06-18): 지도 좌상단에 SUNMAP 로고 표시.
 *
 * 설계 메모:
 *   - 로고 원본이 흰 글자 + 불투명 JPEG 라서 그대로 투명 처리하면 글자가 밝은
 *     지도 위에서 안 보임 → 흰 반투명 둥근 "칩" 배경 위에 얹어 가독성 확보.
 *   - pointer-events: none → 지도 드래그/클릭/줌 모두 투과 (지도 기능 영향 0).
 *   - position: absolute (지도 컨테이너 기준) + 좌상단 고정.
 *   - z-index: 30 → 지도 위, 로딩/에러 오버레이(z-20~30)·모달 아래.
 *   - 모바일에서 지도 라벨을 과하게 가리지 않도록 너비를 작게 (clamp).
 *
 * 로고 교체 시: public/sunmap-logo.jpg 파일만 같은 이름으로 교체하면 됨.
 */
export default function MapLogo() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-2 top-2 z-30 select-none"
    >
      <div className="rounded-xl bg-white/80 shadow-md ring-1 ring-black/5 backdrop-blur-sm px-2 py-1.5">
        <img
          src="/sunmap-logo.jpg"
          alt="SUNMAP"
          draggable={false}
          className="block h-auto w-[140px] max-w-[40vw] rounded-md"
        />
      </div>
    </div>
  );
}
