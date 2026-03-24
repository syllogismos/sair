"use client";

import { useEffect, useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  ScatterChart,
  Scatter,
  ZAxis,
  Cell,
} from "recharts";

interface BreakdownEntry {
  model_id: string;
  benchmark_id: string;
  accuracy: number;
  true_accuracy: number;
  false_accuracy: number;
  total: number;
  correct: number;
}

interface Model {
  model_id: string;
  display_name: string;
  provider: string;
}

const BM_SHORT: Record<string, string> = {
  hard_200_common_25_low_reason: "Hard/Low",
  hard_200_common_25_default_reason: "Hard/Default",
  normal_200_common_25_low_reason: "Normal/Low",
  normal_200_common_25_default_reason: "Normal/Default",
};

export default function ModelBreakdownView() {
  const [data, setData] = useState<BreakdownEntry[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [scatterBenchmark, setScatterBenchmark] = useState<string>("hard_200_common_25_default_reason");

  useEffect(() => {
    Promise.all([
      fetch("/data/model_breakdown.json").then((r) => r.json()),
      fetch("/data/models.json").then((r) => r.json()),
    ]).then(([bd, md]) => {
      setData(bd);
      setModels(md);
      const modelIds = [...new Set(bd.map((x: BreakdownEntry) => x.model_id))];
      if (modelIds.length > 0) setSelectedModel(modelIds[0] as string);
    });
  }, []);

  const modelIds = useMemo(() => [...new Set(data.map((x) => x.model_id))], [data]);

  const modelData = useMemo(
    () => data.filter((x) => x.model_id === selectedModel),
    [data, selectedModel]
  );

  const displayName = (id: string) =>
    models.find((m) => m.model_id === id)?.display_name || id.split("/").pop() || id;

  const benchmarkIds = useMemo(() => [...new Set(data.map((x) => x.benchmark_id))], [data]);

  // TRUE vs FALSE accuracy scatter for all models on selected benchmark
  const scatterData = useMemo(() => {
    return data
      .filter((x) => x.benchmark_id === scatterBenchmark)
      .map((x) => ({
        name: displayName(x.model_id),
        trueAcc: +(x.true_accuracy * 100).toFixed(1),
        falseAcc: +(x.false_accuracy * 100).toFixed(1),
        total: x.total,
      }));
  }, [data, models, scatterBenchmark]);

  const scatterDomain = useMemo(() => {
    if (scatterData.length === 0) return { x: [0, 100] as [number, number], y: [0, 100] as [number, number] };
    const allTrue = scatterData.map((d) => d.trueAcc);
    const allFalse = scatterData.map((d) => d.falseAcc);
    const pad = 8;
    return {
      x: [Math.max(0, Math.floor(Math.min(...allTrue) - pad)), Math.min(105, Math.ceil(Math.max(...allTrue) + pad))] as [number, number],
      y: [Math.max(0, Math.floor(Math.min(...allFalse) - pad)), 105] as [number, number],
    };
  }, [scatterData]);

  if (data.length === 0)
    return <div className="text-zinc-500 py-12 text-center">Loading...</div>;

  return (
    <div className="space-y-6">
      {/* TRUE vs FALSE Accuracy Scatter */}
      <div className="replay-panel p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-1">
          <h3 className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500">
            TRUE vs FALSE Accuracy — {BM_SHORT[scatterBenchmark] || scatterBenchmark}
          </h3>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-zinc-600 uppercase tracking-wider">Benchmark:</label>
            <select
              value={scatterBenchmark}
              onChange={(e) => setScatterBenchmark(e.target.value)}
              className="bg-[#0c0c0f] border border-[#1e1e24] rounded-lg px-2.5 py-1 text-xs text-zinc-300 focus:outline-none focus:border-sky-800"
            >
              {benchmarkIds.map((bm) => (
                <option key={bm} value={bm}>{BM_SHORT[bm] || bm}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-[#71717a] mb-4">
          Models above the diagonal are better at TRUE; below are better at FALSE.
          The key insight: most models are biased toward one direction.
        </p>
        <ResponsiveContainer width="100%" height={350}>
          <ScatterChart margin={{ left: 20, bottom: 20, top: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e24" />
            <XAxis
              type="number"
              dataKey="trueAcc"
              name="TRUE Accuracy"
              domain={scatterDomain.x}
              tick={{ fill: "#52525b", fontSize: 10 }}
              label={{ value: "TRUE Accuracy %", position: "bottom", fill: "#52525b", fontSize: 10 }}
            />
            <YAxis
              type="number"
              dataKey="falseAcc"
              name="FALSE Accuracy"
              domain={scatterDomain.y}
              tick={{ fill: "#52525b", fontSize: 10 }}
              label={{
                value: "FALSE Accuracy %",
                angle: -90,
                position: "insideLeft",
                fill: "#52525b",
                fontSize: 10,
              }}
            />
            <ZAxis range={[60, 60]} />
            <Tooltip
              isAnimationActive={false}
              contentStyle={{
                background: "#141417",
                border: "1px solid #1e1e24",
                borderRadius: 8,
                color: "#fafafa",
                fontSize: 13,
              }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              content={({ payload }: any) => {
                if (!payload || payload.length === 0) return null;
                const d = payload[0]?.payload;
                if (!d) return null;
                return (
                  <div style={{ background: "#141417", border: "1px solid #1e1e24", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
                    <div style={{ color: "#e4e4e7", fontWeight: 600, marginBottom: 4 }}>{d.name}</div>
                    <div style={{ color: "#22c55e" }}>TRUE: {d.trueAcc}%</div>
                    <div style={{ color: "#ef4444" }}>FALSE: {d.falseAcc}%</div>
                  </div>
                );
              }}
            />
            <Scatter
              data={scatterData}
              fill="#0ea5e9"
              fillOpacity={0.8}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              label={({ x, y, index }: any) => (
                <text
                  key={index}
                  x={x + 8}
                  y={y + 14}
                  fill="#71717a"
                  fontSize={9}
                  textAnchor="start"
                  style={{ pointerEvents: "none" }}
                >
                  {scatterData[index]?.name}
                </text>
              )}
            >
              {scatterData.map((entry, i) => (
                <Cell key={i} fill="#38bdf8" />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Per-model breakdown */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <label className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500">Model:</label>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="bg-[#0c0c0f] border border-[#1e1e24] rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-sky-700 w-full sm:w-auto"
        >
          {modelIds.map((id) => (
            <option key={id} value={id}>
              {displayName(id)}
            </option>
          ))}
        </select>
      </div>

      <div className="replay-panel p-6">
        <h3 className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500 mb-4">
          {displayName(selectedModel)} — Accuracy Breakdown
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={modelData.map((x) => ({
              benchmark: BM_SHORT[x.benchmark_id] || x.benchmark_id,
              Overall: +(x.accuracy * 100).toFixed(1),
              TRUE: +(x.true_accuracy * 100).toFixed(1),
              FALSE: +(x.false_accuracy * 100).toFixed(1),
            }))}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e24" />
            <XAxis dataKey="benchmark" tick={{ fill: "#52525b", fontSize: 10 }} />
            <YAxis domain={[0, 100]} tick={{ fill: "#52525b", fontSize: 10 }} />
            <Tooltip
              contentStyle={{
                background: "#141417",
                border: "1px solid #1e1e24",
                borderRadius: 8,
                color: "#fafafa",
                fontSize: 13,
              }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(v: any) => `${v}%`}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Overall" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
            <Bar dataKey="TRUE" fill="#22c55e" radius={[4, 4, 0, 0]} />
            <Bar dataKey="FALSE" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Summary table */}
      <div className="replay-panel overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1e1e24] text-[10px] uppercase tracking-wider text-zinc-600">
              <th className="text-left px-4 py-3 font-normal">Model</th>
              <th className="text-left px-4 py-3 font-normal">Benchmark</th>
              <th className="text-right px-4 py-3 font-normal">Overall</th>
              <th className="text-right px-4 py-3 font-normal">TRUE Acc</th>
              <th className="text-right px-4 py-3 font-normal">FALSE Acc</th>
              <th className="text-right px-4 py-3 font-normal">Bias</th>
            </tr>
          </thead>
          <tbody>
            {data
              .filter((x) => x.benchmark_id === "hard_200_common_25_default_reason")
              .sort((a, b) => b.accuracy - a.accuracy)
              .map((row) => {
                const bias = row.true_accuracy - row.false_accuracy;
                return (
                  <tr
                    key={`${row.model_id}-${row.benchmark_id}`}
                    className="border-b border-[#1e1e24]/50 hover:bg-white/[0.01] transition-colors"
                  >
                    <td className="px-4 py-2.5 font-medium">{displayName(row.model_id)}</td>
                    <td className="px-4 py-2.5 text-zinc-500">
                      {BM_SHORT[row.benchmark_id]}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      {(row.accuracy * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[#22c55e]">
                      {(row.true_accuracy * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[#ef4444]">
                      {(row.false_accuracy * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      <span className={bias > 0.1 ? "text-[#22c55e]" : bias < -0.1 ? "text-[#ef4444]" : "text-zinc-500"}>
                        {bias > 0 ? "+" : ""}
                        {(bias * 100).toFixed(1)}
                      </span>
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
