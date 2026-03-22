"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

interface Run {
  id: number;
  benchmark_id: string;
  problem_id: string;
  model_id: string;
  model_name: string;
  repeat_id: number;
  equation1: string;
  equation2: string;
  answer: number;
  correct: number;
  response: string;
  judge_reason: string;
  elapsed_seconds: number;
  cost_usd: number;
  prompt_tokens: number;
  completion_tokens: number;
}

interface Model {
  model_id: string;
  display_name: string;
}

interface ApiResponse {
  rows: Run[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const BM_SHORT: Record<string, string> = {
  hard_200_common_25_low_reason: "Hard/Low",
  hard_200_common_25_default_reason: "Hard/Default",
  normal_200_common_25_low_reason: "Normal/Low",
  normal_200_common_25_default_reason: "Normal/Default",
};

export default function RunsExplorer() {
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState("all");
  const [selectedBenchmark, setSelectedBenchmark] = useState("all");
  const [filterCorrect, setFilterCorrect] = useState("all");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);

  const PAGE_SIZE = 50;

  useEffect(() => {
    fetch("/data/models.json")
      .then((r) => r.json())
      .then(setModels);
  }, []);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      model: selectedModel,
      benchmark: selectedBenchmark,
      correct: filterCorrect,
      page: page.toString(),
      limit: PAGE_SIZE.toString(),
    });
    const res = await fetch(`/api/runs?${params}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  }, [selectedModel, selectedBenchmark, filterCorrect, page]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const fetchFullRun = async (id: number) => {
    setLoadingRun(true);
    const res = await fetch(`/api/runs/${id}`);
    const json = await res.json();
    setSelectedRun(json);
    setLoadingRun(false);
  };

  const benchmarkIds = [
    "hard_200_common_25_low_reason",
    "hard_200_common_25_default_reason",
    "normal_200_common_25_low_reason",
    "normal_200_common_25_default_reason",
  ];

  const modelIds = useMemo(() => models.map((m) => m.model_id).sort(), [models]);

  const displayName = (id: string) =>
    models.find((m) => m.model_id === id)?.display_name || id.split("/").pop() || id;

  const resetPage = () => setPage(0);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-[#a1a1aa]">Model:</label>
          <select
            value={selectedModel}
            onChange={(e) => { setSelectedModel(e.target.value); resetPage(); }}
            className="bg-[#18181b] border border-[#27272a] rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-[#6366f1]"
          >
            <option value="all">All Models</option>
            {modelIds.map((id) => (
              <option key={id} value={id}>{displayName(id)}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-[#a1a1aa]">Benchmark:</label>
          <select
            value={selectedBenchmark}
            onChange={(e) => { setSelectedBenchmark(e.target.value); resetPage(); }}
            className="bg-[#18181b] border border-[#27272a] rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-[#6366f1]"
          >
            <option value="all">All Benchmarks</option>
            {benchmarkIds.map((id) => (
              <option key={id} value={id}>{BM_SHORT[id] || id}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-[#a1a1aa]">Result:</label>
          <select
            value={filterCorrect}
            onChange={(e) => { setFilterCorrect(e.target.value); resetPage(); }}
            className="bg-[#18181b] border border-[#27272a] rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-[#6366f1]"
          >
            <option value="all">All</option>
            <option value="correct">Correct only</option>
            <option value="incorrect">Incorrect only</option>
          </select>
        </div>
        {data && (
          <div className="ml-auto flex gap-3 text-sm">
            <span className="text-[#a1a1aa]">{data.total.toLocaleString()} runs</span>
          </div>
        )}
      </div>

      {/* Runs table */}
      <div className="bg-[#18181b] border border-[#27272a] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#27272a] text-[#a1a1aa]">
                <th className="text-left px-4 py-3 font-medium">Model</th>
                <th className="text-left px-4 py-3 font-medium">Benchmark</th>
                <th className="text-left px-4 py-3 font-medium">Problem</th>
                <th className="text-left px-4 py-3 font-medium">Eq1</th>
                <th className="text-left px-4 py-3 font-medium">Eq2</th>
                <th className="text-center px-4 py-3 font-medium">Truth</th>
                <th className="text-center px-4 py-3 font-medium">Correct?</th>
                <th className="text-right px-4 py-3 font-medium">Time</th>
                <th className="text-right px-4 py-3 font-medium">Cost</th>
                <th className="text-center px-4 py-3 font-medium">Response</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-[#a1a1aa]">
                    Loading...
                  </td>
                </tr>
              ) : (
                data?.rows.map((run) => (
                  <tr
                    key={run.id}
                    className="border-b border-[#27272a]/50 hover:bg-[#27272a]/30 transition-colors"
                  >
                    <td className="px-4 py-2 text-xs">{run.model_name || displayName(run.model_id)}</td>
                    <td className="px-4 py-2 text-xs text-[#a1a1aa]">{BM_SHORT[run.benchmark_id] || run.benchmark_id}</td>
                    <td className="px-4 py-2 font-mono text-xs text-[#a1a1aa]">{run.problem_id}</td>
                    <td className="px-4 py-2 font-mono text-xs max-w-[160px] truncate">{run.equation1}</td>
                    <td className="px-4 py-2 font-mono text-xs max-w-[160px] truncate">{run.equation2}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`text-xs ${run.answer ? "text-[#22c55e]" : "text-[#ef4444]"}`}>
                        {run.answer ? "T" : "F"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center">
                      {run.correct ? (
                        <span className="text-[#22c55e]">&#10003;</span>
                      ) : (
                        <span className="text-[#ef4444]">&#10007;</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-[#a1a1aa]">
                      {run.elapsed_seconds?.toFixed(1)}s
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-[#a1a1aa]">
                      ${run.cost_usd?.toFixed(4)}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <button
                        onClick={() => fetchFullRun(run.id)}
                        className="text-[#6366f1] hover:text-[#818cf8] text-xs underline"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#27272a]">
            <span className="text-xs text-[#a1a1aa]">
              Page {data.page + 1} of {data.totalPages} ({data.total.toLocaleString()} total)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(0)}
                disabled={page === 0}
                className="px-3 py-1 text-xs rounded bg-[#27272a] disabled:opacity-30 hover:bg-[#3f3f46]"
              >
                First
              </button>
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-3 py-1 text-xs rounded bg-[#27272a] disabled:opacity-30 hover:bg-[#3f3f46]"
              >
                Prev
              </button>
              <button
                onClick={() => setPage(Math.min(data.totalPages - 1, page + 1))}
                disabled={page >= data.totalPages - 1}
                className="px-3 py-1 text-xs rounded bg-[#27272a] disabled:opacity-30 hover:bg-[#3f3f46]"
              >
                Next
              </button>
              <button
                onClick={() => setPage(data.totalPages - 1)}
                disabled={page >= data.totalPages - 1}
                className="px-3 py-1 text-xs rounded bg-[#27272a] disabled:opacity-30 hover:bg-[#3f3f46]"
              >
                Last
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Full response modal */}
      {(selectedRun || loadingRun) && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6"
          onClick={() => { if (!loadingRun) setSelectedRun(null); }}
        >
          <div
            className="bg-[#18181b] border border-[#27272a] rounded-xl max-w-3xl w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {loadingRun ? (
              <div className="px-6 py-12 text-center text-[#a1a1aa]">Loading response...</div>
            ) : selectedRun ? (
              <>
                <div className="flex items-center justify-between px-6 py-4 border-b border-[#27272a]">
                  <div>
                    <h3 className="text-sm font-medium">
                      {selectedRun.model_name || displayName(selectedRun.model_id)} — {selectedRun.problem_id}
                    </h3>
                    <p className="text-xs text-[#a1a1aa] mt-0.5">
                      {BM_SHORT[selectedRun.benchmark_id]} | {selectedRun.correct ? "Correct" : "Incorrect"} | Truth: {selectedRun.answer ? "TRUE" : "FALSE"}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedRun(null)}
                    className="text-[#a1a1aa] hover:text-white px-2 py-1"
                  >
                    Close
                  </button>
                </div>
                <div className="px-6 py-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-[#a1a1aa] mb-1">Equation 1</div>
                      <div className="font-mono text-xs bg-[#09090b] rounded p-2 border border-[#27272a]">
                        {selectedRun.equation1}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[#a1a1aa] mb-1">Equation 2</div>
                      <div className="font-mono text-xs bg-[#09090b] rounded p-2 border border-[#27272a]">
                        {selectedRun.equation2}
                      </div>
                    </div>
                  </div>
                  {selectedRun.judge_reason && (
                    <div>
                      <div className="text-xs text-[#a1a1aa] mb-1">Judge Reason</div>
                      <div className="text-xs bg-[#09090b] rounded p-2 border border-[#27272a]">
                        {selectedRun.judge_reason}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto px-6 pb-6">
                  <div className="text-xs text-[#a1a1aa] mb-1">Full Response</div>
                  <div className="text-sm bg-[#09090b] rounded-lg p-4 border border-[#27272a] prose prose-invert prose-sm max-w-none [&_.katex]:text-[#e2e8f0] [&_p]:text-[#d4d4d8] [&_li]:text-[#d4d4d8] [&_ol]:text-[#d4d4d8] [&_code]:text-[#a78bfa] [&_code]:bg-[#27272a] [&_code]:px-1 [&_code]:rounded">
                    {selectedRun.response ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                      >
                        {selectedRun.response.replace(/\n/g, "  \n")}
                      </ReactMarkdown>
                    ) : (
                      <span className="text-[#a1a1aa]">(no response recorded)</span>
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
