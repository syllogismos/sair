"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

interface Run {
  run_id: string;
  name: string;
  solver: string;
  auto: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  total_calls: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_cost: number;
  total_duration: number;
  total_errors: number;
}

interface CallGroup {
  model: string;
  role: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  duration_secs: number;
  errors: number;
}

interface RecentCall {
  timestamp: number;
  model: string;
  role: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  duration_secs: number;
  response_preview: string | null;
  error: string | null;
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs.toFixed(1)}s`;
  return `${Math.floor(secs / 60)}m ${(secs % 60).toFixed(0)}s`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${(usd * 100).toFixed(2)}¢`;
  return `$${usd.toFixed(4)}`;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    failed: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <span
      className={`px-2 py-0.5 text-xs rounded border ${colors[status] || "bg-zinc-700 text-zinc-400 border-zinc-600"}`}
    >
      {status}
    </span>
  );
}

function ResponseModal({
  call,
  onClose,
}: {
  call: RecentCall;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-[#18181b] border border-[#27272a] rounded-xl max-w-3xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#27272a]">
          <div>
            <h3 className="text-sm font-medium">
              <span
                className={
                  call.role === "reflection"
                    ? "text-purple-400"
                    : "text-cyan-400"
                }
              >
                {call.role}
              </span>{" "}
              — {call.model}
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {new Date(call.timestamp * 1000).toLocaleString()} |{" "}
              {call.duration_secs?.toFixed(1)}s | {formatCost(call.cost_usd || 0)} |{" "}
              {call.prompt_tokens}+{call.completion_tokens} tok
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white px-2 py-1"
          >
            Close
          </button>
        </div>
        {call.error && (
          <div className="px-6 py-3 bg-red-950/20 border-b border-red-900/30">
            <div className="text-xs text-red-400 font-mono">{call.error}</div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="text-xs text-zinc-500 mb-1">Response</div>
          <div className="text-sm bg-[#09090b] rounded-lg p-4 border border-[#27272a] prose prose-invert prose-sm max-w-none [&_.katex]:text-[#e2e8f0] [&_p]:text-[#d4d4d8] [&_li]:text-[#d4d4d8] [&_code]:text-[#a78bfa] [&_code]:bg-[#27272a] [&_code]:px-1 [&_code]:rounded">
            {call.response_preview ? (
              <ReactMarkdown
                remarkPlugins={[remarkMath]}
                rehypePlugins={[rehypeKatex]}
              >
                {call.response_preview.replace(/\n/g, "  \n")}
              </ReactMarkdown>
            ) : (
              <span className="text-zinc-500">(no response recorded)</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const [data, setData] = useState<{
    run: Run;
    calls: CallGroup[];
    recentCalls: RecentCall[];
  } | null>(null);
  const [viewCall, setViewCall] = useState<RecentCall | null>(null);

  useEffect(() => {
    fetch(`/api/gepa?run_id=${runId}`)
      .then((r) => r.json())
      .then(setData);
  }, [runId]);

  if (!data) return <div className="text-zinc-500">Loading...</div>;
  const { run, calls, recentCalls } = data;

  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="text-sm text-zinc-400 hover:text-white transition"
      >
        &larr; Back to runs
      </button>

      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">{run.name || run.run_id}</h2>
        <StatusBadge status={run.status} />
        <span className="text-xs text-zinc-500 font-mono">{run.run_id}</span>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Solver", value: run.solver },
          { label: "Auto", value: run.auto },
          { label: "Started", value: formatTime(run.started_at) },
          {
            label: "Duration",
            value: run.finished_at
              ? formatDuration(run.finished_at - run.started_at)
              : "running...",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-3"
          >
            <div className="text-xs text-zinc-500">{s.label}</div>
            <div className="text-sm font-medium mt-1">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Per-model breakdown */}
      <div>
        <h3 className="text-sm font-medium text-zinc-400 mb-2">
          Model Breakdown
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 border-b border-zinc-800">
              <th className="pb-2">Model</th>
              <th className="pb-2">Role</th>
              <th className="pb-2 text-right">Calls</th>
              <th className="pb-2 text-right">Prompt Tok</th>
              <th className="pb-2 text-right">Comp Tok</th>
              <th className="pb-2 text-right">Cost</th>
              <th className="pb-2 text-right">Time</th>
              <th className="pb-2 text-right">Errors</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c, i) => (
              <tr key={i} className="border-b border-zinc-800/50">
                <td className="py-2 font-mono text-xs">{c.model}</td>
                <td className="py-2">
                  <span
                    className={
                      c.role === "reflection"
                        ? "text-purple-400"
                        : "text-cyan-400"
                    }
                  >
                    {c.role}
                  </span>
                </td>
                <td className="py-2 text-right">{c.calls}</td>
                <td className="py-2 text-right">
                  {c.prompt_tokens?.toLocaleString()}
                </td>
                <td className="py-2 text-right">
                  {c.completion_tokens?.toLocaleString()}
                </td>
                <td className="py-2 text-right">{formatCost(c.cost_usd || 0)}</td>
                <td className="py-2 text-right">
                  {formatDuration(c.duration_secs || 0)}
                </td>
                <td className="py-2 text-right">
                  {c.errors > 0 ? (
                    <span className="text-red-400">{c.errors}</span>
                  ) : (
                    <span className="text-zinc-600">0</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recent calls */}
      <div>
        <h3 className="text-sm font-medium text-zinc-400 mb-2">
          Recent Calls (last 50)
        </h3>
        <div className="space-y-1 max-h-[500px] overflow-y-auto">
          {recentCalls.map((c, i) => (
            <div
              key={i}
              onClick={() => setViewCall(c)}
              className={`text-xs font-mono p-2 rounded border cursor-pointer transition-colors ${
                c.error
                  ? "border-red-900/50 bg-red-950/20 hover:bg-red-950/30"
                  : "border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-zinc-500">
                  {new Date(c.timestamp * 1000).toLocaleTimeString()}
                </span>
                <span
                  className={
                    c.role === "reflection"
                      ? "text-purple-400"
                      : "text-cyan-400"
                  }
                >
                  {c.role}
                </span>
                <span className="text-zinc-400">{c.model}</span>
                <span className="text-zinc-600 ml-auto">
                  {c.prompt_tokens}+{c.completion_tokens} tok
                </span>
                <span className="text-zinc-600">
                  {formatCost(c.cost_usd || 0)}
                </span>
                <span className="text-zinc-600">
                  {c.duration_secs?.toFixed(1)}s
                </span>
              </div>
              {c.error && (
                <div className="text-red-400 mt-1 truncate">{c.error}</div>
              )}
              {c.response_preview && !c.error && (
                <div className="text-zinc-600 mt-1 truncate">
                  {c.response_preview.slice(0, 150)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {viewCall && (
        <ResponseModal call={viewCall} onClose={() => setViewCall(null)} />
      )}
    </div>
  );
}

export default function GepaExperiments() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/gepa")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        setRuns(data.runs || []);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (selectedRun) {
    return (
      <RunDetail
        runId={selectedRun}
        onBack={() => setSelectedRun(null)}
      />
    );
  }

  if (error) {
    return (
      <div className="text-zinc-500 text-sm">
        <p>No GEPA experiment data yet.</p>
        <p className="text-xs mt-1 text-zinc-600">
          Run <code className="bg-zinc-800 px-1 rounded">python src/run_gepa.py --solver v1 --auto light</code> to start an experiment.
        </p>
        <p className="text-xs mt-1 text-zinc-700">{error}</p>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="text-zinc-500 text-sm">
        No experiments yet. Start one with{" "}
        <code className="bg-zinc-800 px-1 rounded">python src/run_gepa.py</code>
      </div>
    );
  }

  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-zinc-500 border-b border-zinc-800">
            <th className="pb-2">Run</th>
            <th className="pb-2">Status</th>
            <th className="pb-2">Solver</th>
            <th className="pb-2">Auto</th>
            <th className="pb-2 text-right">Calls</th>
            <th className="pb-2 text-right">Tokens</th>
            <th className="pb-2 text-right">Cost</th>
            <th className="pb-2 text-right">Duration</th>
            <th className="pb-2 text-right">Errors</th>
            <th className="pb-2">Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr
              key={r.run_id}
              className="border-b border-zinc-800/50 hover:bg-zinc-900/50 cursor-pointer"
              onClick={() => setSelectedRun(r.run_id)}
            >
              <td className="py-2">
                <div className="font-medium">{r.name || r.run_id}</div>
                <div className="text-xs text-zinc-600 font-mono">
                  {r.run_id}
                </div>
              </td>
              <td className="py-2">
                <StatusBadge status={r.status} />
              </td>
              <td className="py-2">{r.solver}</td>
              <td className="py-2">{r.auto}</td>
              <td className="py-2 text-right">{r.total_calls}</td>
              <td className="py-2 text-right text-xs">
                {((r.total_prompt_tokens || 0) + (r.total_completion_tokens || 0)).toLocaleString()}
              </td>
              <td className="py-2 text-right">
                {formatCost(r.total_cost || 0)}
              </td>
              <td className="py-2 text-right">
                {formatDuration(r.total_duration || 0)}
              </td>
              <td className="py-2 text-right">
                {(r.total_errors || 0) > 0 ? (
                  <span className="text-red-400">{r.total_errors}</span>
                ) : (
                  <span className="text-zinc-600">0</span>
                )}
              </td>
              <td className="py-2 text-xs text-zinc-500">
                {formatTime(r.started_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
