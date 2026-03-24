"use client";

import { useEffect, useState, useMemo } from "react";
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

function shortModelName(modelId: string, models: Model[]): string {
  const m = models.find((x) => x.model_id === modelId);
  return m?.display_name || modelId.split("/").pop() || modelId;
}

export default function LeaderboardView() {
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedBenchmark, setSelectedBenchmark] = useState<string>("");
  const [sortBy, setSortBy] = useState<"accuracy" | "f1_score" | "avg_cost_usd">("accuracy");

  useEffect(() => {
    Promise.all([
      fetch("/data/leaderboard.json").then((r) => r.json()),
      fetch("/data/models.json").then((r) => r.json()),
    ]).then(([lb, md]) => {
      setData(lb);
      setModels(md);
      const benchmarks = [...new Set(lb.map((x: LeaderboardEntry) => x.benchmark_id))];
      if (benchmarks.length > 0) setSelectedBenchmark(benchmarks[0] as string);
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
        name: shortModelName(x.model_id, models),
        accuracy: +(x.accuracy * 100).toFixed(1),
        f1: +(x.f1_score * 100).toFixed(1),
        cost: +x.avg_cost_usd.toFixed(4),
        consistency: +(x.repeat_consistency * 100).toFixed(1),
      })),
    [filtered, models]
  );

  if (data.length === 0)
    return <div className="text-zinc-500 py-12 text-center">Loading...</div>;

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500">Benchmark:</label>
          <select
            value={selectedBenchmark}
            onChange={(e) => setSelectedBenchmark(e.target.value)}
            className="bg-[#0c0c0f] border border-[#1e1e24] rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-sky-800/50"
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
            className="bg-[#0c0c0f] border border-[#1e1e24] rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-sky-800/50"
          >
            <option value="accuracy">Accuracy</option>
            <option value="f1_score">F1 Score</option>
            <option value="avg_cost_usd">Cost (low first)</option>
          </select>
        </div>
      </div>

      {/* Chart */}
      <div className="replay-panel p-6">
        <h3 className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500 mb-4">
          Accuracy by Model — {BENCHMARK_LABELS[selectedBenchmark] || selectedBenchmark}
        </h3>
        <ResponsiveContainer width="100%" height={Math.max(400, chartData.length * 20)}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e24" />
            <XAxis type="number" domain={[0, 100]} tick={{ fill: "#52525b", fontSize: 12 }} />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fill: "#a1a1aa", fontSize: 12 }}
              width={240}
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
              formatter={(value: any, name: any) => {
                if (name === "accuracy") return [`${value}%`, "Accuracy"];
                return [value, name];
              }}
            />
            <Bar dataKey="accuracy" radius={[0, 3, 3, 0]} barSize={14}>
              {chartData.map((entry, index) => (
                <Cell
                  key={index}
                  fill={
                    entry.accuracy >= 70
                      ? "#22c55e"
                      : entry.accuracy >= 55
                        ? "#f59e0b"
                        : "#ef4444"
                  }
                  fillOpacity={0.8}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Table */}
      <div className="replay-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e1e24]/50">
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">#</th>
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Model</th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Accuracy</th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">F1</th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">TP</th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">FP</th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">FN</th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">TN</th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Parse %</th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Consistency</th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Avg Cost</th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Avg Time</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr
                  key={row.model_id}
                  className="border-b border-[#1e1e24]/50 hover:bg-white/[0.01] transition-colors"
                >
                  <td className="px-4 py-2.5 text-zinc-500">{i + 1}</td>
                  <td className="px-4 py-2.5 font-medium">
                    {shortModelName(row.model_id, models)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
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
                  <td className="px-4 py-2.5 text-right font-mono">
                    {(row.f1_score * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-[#22c55e]">{row.tp}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[#ef4444]">{row.fp}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[#ef4444]">{row.fn}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[#22c55e]">{row.tn}</td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {(row.parse_success_rate * 100).toFixed(0)}%
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {(row.repeat_consistency * 100).toFixed(0)}%
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-zinc-500">
                    ${row.avg_cost_usd.toFixed(4)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-zinc-500">
                    {row.avg_time_secs.toFixed(1)}s
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
