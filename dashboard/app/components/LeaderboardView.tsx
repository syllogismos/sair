"use client";

import { useEffect, useState, useMemo, useCallback } from "react";

function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);
  return isMobile;
}
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
} from "recharts";

interface LeaderboardEntry {
  benchmark_id: string;
  model_id: string;
  f1_score: number;
  parse_success_rate: number;
  avg_cost_usd: number;
  avg_time_secs: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  unparsed: number;
  repeat_consistency: number;
  run_count: number;
  problem_count: number;
  repeat_count: number;
  accuracy: number;
}

interface Model {
  model_id: string;
  display_name: string;
  provider: string;
  family: string;
}

const BENCHMARK_LABELS: Record<string, string> = {
  hard_200_common_25_low_reason: "Hard / Low Reasoning",
  hard_200_common_25_default_reason: "Hard / Default Reasoning",
  normal_200_common_25_low_reason: "Normal / Low Reasoning",
  normal_200_common_25_default_reason: "Normal / Default Reasoning",
};

function shortModelName(modelId: string, models: Model[], maxLen?: number): string {
  const m = models.find((x) => x.model_id === modelId);
  const name = m?.display_name || modelId.split("/").pop() || modelId;
  if (maxLen && name.length > maxLen) return name.slice(0, maxLen - 1) + "\u2026";
  return name;
}

function isOurModel(modelId: string, models: Model[]): boolean {
  const m = models.find((x) => x.model_id === modelId);
  return m?.provider === "ours";
}

export default function LeaderboardView() {
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedBenchmark, setSelectedBenchmark] = useState<string>("");
  const [sortBy, setSortBy] = useState<"accuracy" | "f1_score" | "avg_cost_usd">("accuracy");
  const isMobile = useIsMobile();

  useEffect(() => {
    // Try combined API (merges benchmark + our eval runs), fallback to static JSON
    fetch("/api/leaderboard")
      .then((r) => r.ok ? r.json() : Promise.reject("API failed"))
      .then(({ leaderboard: lb, models: md }) => {
        setData(lb);
        setModels(md);
        const benchmarks = [...new Set(lb.map((x: LeaderboardEntry) => x.benchmark_id))];
        if (benchmarks.length > 0 && !selectedBenchmark) setSelectedBenchmark(benchmarks[0] as string);
      })
      .catch(() => {
        // Fallback to static JSON
        Promise.all([
          fetch("/data/leaderboard.json").then((r) => r.json()),
          fetch("/data/models.json").then((r) => r.json()),
        ]).then(([lb, md]) => {
          setData(lb);
          setModels(md);
          const benchmarks = [...new Set(lb.map((x: LeaderboardEntry) => x.benchmark_id))];
          if (benchmarks.length > 0) setSelectedBenchmark(benchmarks[0] as string);
        });
      });
  }, []);

  const benchmarks = useMemo(
    () => [...new Set(data.map((x) => x.benchmark_id))],
    [data]
  );

  const filtered = useMemo(() => {
    return data
      .filter((x) => x.benchmark_id === selectedBenchmark)
      .sort((a, b) => {
        if (sortBy === "avg_cost_usd") return a[sortBy] - b[sortBy];
        return b[sortBy] - a[sortBy];
      });
  }, [data, selectedBenchmark, sortBy]);

  const chartData = useMemo(
    () =>
      filtered.map((x) => ({
        name: shortModelName(x.model_id, models, isMobile ? 14 : undefined),
        accuracy: +(x.accuracy * 100).toFixed(1),
        f1: +(x.f1_score * 100).toFixed(1),
        cost: +x.avg_cost_usd.toFixed(4),
        consistency: +(x.repeat_consistency * 100).toFixed(1),
        isOurs: isOurModel(x.model_id, models),
      })),
    [filtered, models, isMobile]
  );

  if (data.length === 0)
    return <div className="text-zinc-500 py-12 text-center">Loading...</div>;

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500">Benchmark:</label>
          <select
            value={selectedBenchmark}
            onChange={(e) => setSelectedBenchmark(e.target.value)}
            className="bg-[#0c0c0f] border border-[#1e1e24] rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-sky-800/50 w-full sm:w-auto"
          >
            {benchmarks.map((b) => (
              <option key={b} value={b}>
                {BENCHMARK_LABELS[b] || b}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500">Sort by:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="bg-[#0c0c0f] border border-[#1e1e24] rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-sky-800/50 w-full sm:w-auto"
          >
            <option value="accuracy">Accuracy</option>
            <option value="f1_score">F1 Score</option>
            <option value="avg_cost_usd">Cost (low first)</option>
          </select>
        </div>
      </div>

      {/* Chart */}
      {(() => {
        const chartKey = sortBy === "f1_score" ? "f1" : sortBy === "avg_cost_usd" ? "cost" : "accuracy";
        const chartLabel = sortBy === "f1_score" ? "F1 Score" : sortBy === "avg_cost_usd" ? "Cost (USD)" : "Accuracy";
        const isPercent = chartKey !== "cost";
        const domain: [number, number] = isPercent ? [0, 100] : [0, Math.max(...chartData.map((d) => d.cost), 0.01)];

        function barColor(entry: typeof chartData[number]) {
          if (entry.isOurs) return "#06b6d4";
          if (chartKey === "cost") return "#8b5cf6";
          const val = chartKey === "f1" ? entry.f1 : entry.accuracy;
          return val >= 70 ? "#22c55e" : val >= 55 ? "#f59e0b" : "#ef4444";
        }

        return (
          <div className="replay-panel p-3 sm:p-6">
            <h3 className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500 mb-4">
              {chartLabel} by Model — {BENCHMARK_LABELS[selectedBenchmark] || selectedBenchmark}
            </h3>
            <ResponsiveContainer width="100%" height={Math.max(400, chartData.length * 20)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e24" />
                <XAxis type="number" domain={domain} tick={{ fill: "#52525b", fontSize: isMobile ? 10 : 12 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: "#a1a1aa", fontSize: isMobile ? 9 : 12 }}
                  width={isMobile ? 90 : 140}
                  interval={0}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0c0c0f",
                    border: "1px solid #1e1e24",
                    borderRadius: 8,
                    color: "#fafafa",
                    fontSize: 13,
                  }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any) => [isPercent ? `${value}%` : `$${value}`, chartLabel]}
                />
                <Bar dataKey={chartKey} radius={[0, 3, 3, 0]} barSize={14}>
                  {chartData.map((entry, index) => (
                    <Cell
                      key={index}
                      fill={barColor(entry)}
                      fillOpacity={entry.isOurs ? 1.0 : 0.8}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      })()}

      {/* Table */}
      <div className="replay-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-[#1e1e24]/50">
                <th className="text-left px-2 sm:px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">#</th>
                <th className="text-left px-2 sm:px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Model</th>
                <th className="text-right px-2 sm:px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Accuracy</th>
                <th className="text-right px-2 sm:px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">F1</th>
                <th className="text-right px-2 sm:px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal hidden sm:table-cell">TP</th>
                <th className="text-right px-2 sm:px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal hidden sm:table-cell">FP</th>
                <th className="text-right px-2 sm:px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal hidden sm:table-cell">FN</th>
                <th className="text-right px-2 sm:px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal hidden sm:table-cell">TN</th>
                <th className="text-right px-2 sm:px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal hidden sm:table-cell">Parse %</th>
                <th className="text-right px-2 sm:px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal hidden sm:table-cell">Consistency</th>
                <th className="text-right px-2 sm:px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Avg Cost</th>
                <th className="text-right px-2 sm:px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Avg Time</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const ours = isOurModel(row.model_id, models);
                return (
                <tr
                  key={row.model_id}
                  className={`border-b border-[#1e1e24]/50 hover:bg-white/[0.01] transition-colors ${
                    ours ? "bg-cyan-500/[0.06] border-l-2 border-l-cyan-500" : ""
                  }`}
                >
                  <td className="px-2 sm:px-4 py-2.5 text-zinc-500">{i + 1}</td>
                  <td className="px-2 sm:px-4 py-2.5 font-medium">
                    {ours && <span className="text-[9px] font-bold tracking-wider text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded mr-2">OURS</span>}
                    {shortModelName(row.model_id, models)}
                  </td>
                  <td className="px-2 sm:px-4 py-2.5 text-right font-mono">
                    <span
                      className={
                        row.accuracy >= 0.7
                          ? "text-[#22c55e]"
                          : row.accuracy >= 0.55
                            ? "text-[#f59e0b]"
                            : "text-[#ef4444]"
                      }
                    >
                      {(row.accuracy * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-2 sm:px-4 py-2.5 text-right font-mono">
                    {(row.f1_score * 100).toFixed(1)}%
                  </td>
                  <td className="px-2 sm:px-4 py-2.5 text-right font-mono text-[#22c55e] hidden sm:table-cell">{row.tp}</td>
                  <td className="px-2 sm:px-4 py-2.5 text-right font-mono text-[#ef4444] hidden sm:table-cell">{row.fp}</td>
                  <td className="px-2 sm:px-4 py-2.5 text-right font-mono text-[#ef4444] hidden sm:table-cell">{row.fn}</td>
                  <td className="px-2 sm:px-4 py-2.5 text-right font-mono text-[#22c55e] hidden sm:table-cell">{row.tn}</td>
                  <td className="px-2 sm:px-4 py-2.5 text-right font-mono hidden sm:table-cell">
                    {(row.parse_success_rate * 100).toFixed(0)}%
                  </td>
                  <td className="px-2 sm:px-4 py-2.5 text-right font-mono hidden sm:table-cell">
                    {(row.repeat_consistency * 100).toFixed(0)}%
                  </td>
                  <td className="px-2 sm:px-4 py-2.5 text-right font-mono text-zinc-500">
                    ${row.avg_cost_usd.toFixed(4)}
                  </td>
                  <td className="px-2 sm:px-4 py-2.5 text-right font-mono text-zinc-500">
                    {row.avg_time_secs.toFixed(1)}s
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
