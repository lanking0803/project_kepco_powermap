import { CrawlJob, formatScope, relativeTime } from "@/lib/crawler";
import { CrawlStatusBadge } from "./CrawlStatusBadge";

interface Props {
  job: CrawlJob;
  onStop: (jobId: number) => void;
  onDelete: (jobId: number) => void;
}

export function ActiveJobCard({ job, onStop }: Props) {
  // onDelete 는 호출처에서 전달되지만 active 카드 안에선 미사용 (정지만 노출).
  // history 영역에서 삭제 액션 별도 처리.
  const processed = job.progress.processed || 0;
  const found = job.progress.found || 0;
  const errors = job.progress.errors || 0;
  const noData = Math.max(0, processed - found - errors);

  const opts = (job.options || {}) as Record<string, any>;
  const flush = opts.flush_size || 100;
  const delay = opts.delay || 0.5;
  const progInterval = opts.progress_interval || 10;
  const hasStep = opts.fetch_step_data;

  return (
    <div className="bg-white rounded-xl border-2 border-blue-300 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-white bg-gray-500 rounded px-1.5 py-0.5">
            {job.thread || 1}번
          </span>
          {job.mode === "recurring" && (
            <span className="text-[10px] font-bold text-orange-700 bg-orange-100 rounded px-1.5 py-0.5">
              반복{job.cycle_count > 0 ? ` ${job.cycle_count + 1}회차` : ""}
            </span>
          )}
          <CrawlStatusBadge job={job} />
          <span className="text-base font-semibold text-gray-900">{formatScope(job)}</span>
          <span className="text-sm text-gray-400">Job #{job.id}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* intent='cancel' 중이면 버튼 비활성화 (이중 클릭 방지) */}
          {(job.status === "running" || job.status === "pending") && (
            <button
              onClick={() => onStop(job.id)}
              disabled={job.intent === "cancel"}
              className="text-sm text-red-600 hover:text-red-800 border border-red-300 hover:bg-red-50 px-4 py-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {job.intent === "cancel" ? "정지 처리 중..." : job.status === "running" ? "중단" : "취소"}
            </button>
          )}
        </div>
      </div>

      {job.progress.processed != null && (
        <div className="space-y-3">
          <div className="grid grid-cols-5 gap-2">
            <div className="bg-green-50 rounded-lg px-3 py-3 text-center">
              <div className="text-xl font-bold text-green-700">{found.toLocaleString()}</div>
              <div className="text-xs text-green-600 mt-0.5">수집</div>
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-3 text-center">
              <div className="text-xl font-bold text-gray-500">{noData.toLocaleString()}</div>
              <div className="text-xs text-gray-400 mt-0.5">정보없음</div>
            </div>
            <div className="bg-purple-50 rounded-lg px-3 py-3 text-center">
              <div className="text-xl font-bold text-purple-700">{(job.progress.geocoded || 0).toLocaleString()}</div>
              <div className="text-xs text-purple-600 mt-0.5">좌표변환</div>
            </div>
            <div className={`rounded-lg px-3 py-3 text-center ${errors > 0 ? "bg-orange-50" : "bg-gray-50"}`}>
              <div className={`text-xl font-bold ${errors > 0 ? "text-orange-700" : "text-gray-400"}`}>{errors}</div>
              <div className={`text-xs mt-0.5 ${errors > 0 ? "text-orange-600" : "text-gray-400"}`}>미수집 지번</div>
            </div>
            <div className="bg-blue-50 rounded-lg px-3 py-3 text-center">
              <div className="text-xl font-bold text-blue-700">{processed.toLocaleString()}</div>
              <div className="text-xs text-blue-600 mt-0.5">총 조회</div>
            </div>
          </div>

          {job.progress.recent_errors && job.progress.recent_errors.length > 0 && (
            <div className="bg-orange-50 rounded-lg px-4 py-3 border border-orange-100">
              <div className="text-xs font-bold text-orange-600 mb-1.5">미수집 지번 ({job.progress.recent_errors.length}건)</div>
              <div className="space-y-1">
                {job.progress.recent_errors.slice(-5).map((err, i) => (
                  <div key={i} className="text-[11px] text-orange-700 flex gap-2">
                    <span className="text-orange-500 flex-shrink-0">{err.addr}</span>
                    <span className="truncate text-gray-500">{err.error}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 설정 vs 추출 중 — 테이블 비교 */}
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-100 border-b border-gray-200">
                  <th className="px-3 py-1.5 text-left text-[10px] font-bold text-gray-500 w-16"></th>
                  <th className="px-2 py-1.5 text-center text-[10px] font-bold text-gray-500">시/도</th>
                  <th className="px-2 py-1.5 text-center text-[10px] font-bold text-gray-500">시</th>
                  <th className="px-2 py-1.5 text-center text-[10px] font-bold text-gray-500">구/군</th>
                  <th className="px-2 py-1.5 text-center text-[10px] font-bold text-gray-500">동/면</th>
                  <th className="px-2 py-1.5 text-center text-[10px] font-bold text-gray-500">리</th>
                  <th className="px-2 py-1.5 text-center text-[10px] font-bold text-gray-500">번지</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-200 bg-gray-50/50">
                  <td className="px-3 py-2"><span className="inline-block text-[10px] font-bold text-gray-400 bg-gray-200 rounded px-1.5 py-0.5">설정</span></td>
                  <td className="px-2 py-2 text-center font-medium text-gray-600">{job.sido || "-"}</td>
                  <td className="px-2 py-2 text-center font-medium text-gray-600">{job.si || "전체"}</td>
                  <td className="px-2 py-2 text-center font-medium text-gray-600">{job.gu || "전체"}</td>
                  <td className="px-2 py-2 text-center font-medium text-gray-600">{job.dong || "전체"}</td>
                  <td className="px-2 py-2 text-center text-gray-400">-</td>
                  <td className="px-2 py-2 text-center text-gray-400">-</td>
                </tr>
                {job.progress.addr_parts ? (() => {
                  const idx = job.progress.indices;
                  const tag = (key: string) => (idx?.[key]?.[1] ? ` (${idx[key][0]}/${idx[key][1]})` : "");
                  return (
                    <tr className="bg-blue-50 border-l-2 border-l-blue-400">
                      <td className="px-3 py-2 whitespace-nowrap"><span className="inline-block text-[10px] font-bold text-blue-600 bg-blue-100 rounded px-1.5 py-0.5">추출 중</span></td>
                      <td className="px-2 py-2 text-center font-semibold text-gray-800">{job.progress.addr_parts.sido || "-"}</td>
                      <td className="px-2 py-2 text-center font-semibold text-gray-800">{job.progress.addr_parts.si || "-"}<span className="text-[10px] text-blue-500 font-normal">{tag("si")}</span></td>
                      <td className="px-2 py-2 text-center font-semibold text-gray-800">{job.progress.addr_parts.gu || "-"}<span className="text-[10px] text-blue-500 font-normal">{tag("gu")}</span></td>
                      <td className="px-2 py-2 text-center font-semibold text-gray-800">{job.progress.addr_parts.dong || "-"}<span className="text-[10px] text-blue-500 font-normal">{tag("dong")}</span></td>
                      <td className="px-2 py-2 text-center font-semibold text-gray-800">{job.progress.addr_parts.li || "-"}<span className="text-[10px] text-blue-500 font-normal">{tag("li")}</span></td>
                      <td className="px-2 py-2 text-center font-bold text-blue-700">{job.progress.addr_parts.jibun || "-"}<span className="text-[10px] text-blue-500 font-normal">{tag("jibun")}</span></td>
                    </tr>
                  );
                })() : job.progress.current_address ? (
                  <tr className="bg-blue-50 border-l-2 border-l-blue-400">
                    <td className="px-3 py-2 whitespace-nowrap"><span className="inline-block text-[10px] font-bold text-blue-600 bg-blue-100 rounded px-1.5 py-0.5">추출 중</span></td>
                    <td colSpan={6} className="px-2 py-2 font-medium text-gray-800">{job.progress.current_address}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="bg-gray-50 rounded-lg px-4 py-3 text-xs text-gray-500">
            <div className="flex items-center justify-between mb-2">
              {job.started_at && <span>{relativeTime(job.started_at)} 시작</span>}
            </div>
            <table className="w-full">
              <tbody>
                <tr className="border-t border-gray-200">
                  <td className="py-1.5 font-semibold text-gray-600 w-1/3">API 호출 간격</td>
                  <td className="py-1.5 text-gray-700 font-medium">{delay}초{hasStep ? " (STEP 포함)" : ""}</td>
                </tr>
                <tr className="border-t border-gray-200">
                  <td className="py-1.5 font-semibold text-gray-600">배치 크기</td>
                  <td className="py-1.5 text-gray-700 font-medium">{flush}건마다 → DB 저장 + 좌표 변환 + 체크포인트 + 변화 감지 (지도 반영은 1시간 간격)</td>
                </tr>
                <tr className="border-t border-gray-200">
                  <td className="py-1.5 font-semibold text-gray-600">화면 갱신 주기</td>
                  <td className="py-1.5 text-gray-700 font-medium">{progInterval}건마다 (~{Math.round(progInterval * delay)}초) → 진행 상황 + 중단 확인</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
