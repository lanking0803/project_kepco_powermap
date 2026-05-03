/**
 * 읍·면·동 단위 행정구역 조회 (서버 lib).
 *
 * 출처: bjd_master 테이블 (행안부 법정동 코드 마스터, 월 1회 CSV 갱신).
 * 응답: 한 시군구 안의 읍·면·동 + 그 아래 리 (있는 경우만 같이).
 *
 * 외부 건축HUB API (getBrTitleInfo) 의 작동 단위 (실측 2026-05-03):
 *   - 도시 동 (sep_5 NULL)        → sep_4 코드로 응답  ✅
 *   - 농촌 읍/면 (sep_5 NULL)     → 0건 (외부 API 미지원)  ❌
 *   - 농촌 리 (sep_5 NOT NULL)    → sep_5 코드로 응답  ✅
 *
 * 따라서:
 *   - 도시: 사용자가 읍·면·동(sep_4) 선택 → 끝
 *   - 농촌: 사용자가 읍·면(sep_4) 선택 → 리(sep_5) 한 번 더 선택
 *
 * 응답 구조 (1번 호출에 모든 정보 포함, 추가 fetch 0):
 *   { code, label, hasChildren, children: [{ code, label }] }
 *   - 도시 동: hasChildren=false, children=[]
 *   - 농촌 면: hasChildren=true,  children=[리1, 리2, ...]
 */
import { createAdminClient } from "@/lib/supabase/admin";

export interface EupmyeondongChild {
  /** 리 bjd_code 10자리 — 외부 API 호출 키 */
  code: string;
  /** 리 한글명 (예: "신월리") */
  label: string;
}

export interface EupmyeondongEntry {
  /** bjd_code 10자리 (예: "4673025000" or "1168010100") */
  code: string;
  /** sep_4 한글 (예: "구례읍" / "역삼동") */
  label: string;
  /** sep_1 — 시도 한글 (참조용) */
  sido: string;
  /** sep_2 — 일반시 한글 또는 null */
  si: string | null;
  /** sep_3 — 자치구/행정구/군 한글 또는 null */
  gu: string | null;
  /**
   * 자식 리 존재 여부.
   * - false (도시): code 자체가 외부 API 호출 키
   * - true (농촌): code 는 외부 API 0건 — children 의 리 코드를 사용해야 함
   */
  hasChildren: boolean;
  /** 자식 리 목록 (sep_5). hasChildren=false 면 빈 배열. */
  children: EupmyeondongChild[];
}

interface BjdMasterRow {
  bjd_code: string;
  sep_1: string;
  sep_2: string | null;
  sep_3: string | null;
  sep_4: string | null;
  sep_5: string | null;
}

/**
 * 시군구 5자리 prefix 로 읍·면·동 + 그 아래 리 까지 한 번에 추출.
 *
 * SQL: 시군구 prefix 로 LIKE 매치 후 클라이언트에서 트리 조립.
 *   - sep_4 NOT NULL + sep_5 NULL  → 부모 노드 (도시동 또는 농촌읍/면)
 *   - sep_4 NOT NULL + sep_5 NOT NULL → 자식 (농촌 리)
 *   - sep_4 NULL                    → 시군구 자체 (제외)
 *
 * 부모-자식 매칭은 동일 sep_4 (한글명) 기준 — bjd_code 6~8번째 자리도 일치.
 */
export async function listEupmyeondongs(
  sigunguCode: string,
): Promise<EupmyeondongEntry[]> {
  if (!/^\d{5}$/.test(sigunguCode)) return [];

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("bjd_master")
    .select("bjd_code, sep_1, sep_2, sep_3, sep_4, sep_5")
    .like("bjd_code", `${sigunguCode}_____`)
    .order("bjd_code");

  if (error) {
    console.error("[regions/eupmyeondong] bjd_master 조회 실패", error);
    return [];
  }

  const rows = (data ?? []) as BjdMasterRow[];

  // bjd_code 6~8번째 자리 (읍·면·동 부분) 별로 그룹화
  // 각 그룹의 부모 (sep_5=null) 1개 + 자식 (sep_5 not null) 0~N개
  type Group = {
    parent: BjdMasterRow | null;
    children: BjdMasterRow[];
  };
  const groups = new Map<string, Group>();

  for (const r of rows) {
    if (!r.bjd_code || r.bjd_code.length !== 10) continue;
    if (!r.sep_4) continue; // 시군구 자체 행 제외
    const dongCode = r.bjd_code.slice(5, 8); // 예 "250" (구례읍)
    if (dongCode === "000") continue; // 시군구 자체

    let g = groups.get(dongCode);
    if (!g) {
      g = { parent: null, children: [] };
      groups.set(dongCode, g);
    }
    if (r.sep_5 == null) {
      g.parent = r;
    } else {
      g.children.push(r);
    }
  }

  // 그룹별로 EupmyeondongEntry 생성. 부모 없는 그룹(자식만 있는 비정상)은 자식 첫 행을 부모로 승격.
  const out: EupmyeondongEntry[] = [];
  for (const [, g] of groups) {
    const parent = g.parent ?? g.children[0];
    if (!parent) continue;

    const children: EupmyeondongChild[] = g.children
      .filter((c) => c.sep_5)
      .map((c) => ({
        code: c.bjd_code,
        label: c.sep_5 as string,
      }));

    out.push({
      code: parent.bjd_code,
      label: parent.sep_4 as string,
      sido: parent.sep_1,
      si: parent.sep_2,
      gu: parent.sep_3,
      hasChildren: children.length > 0,
      children,
    });
  }

  // sep_4 가나다순 정렬
  out.sort((a, b) => a.label.localeCompare(b.label, "ko"));
  return out;
}
