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

  // TRUE vs FALSE accuracy scatter for all models on one benchmark
  const scatterData = useMemo(() => {
    const bm = "hard_200_common_25_default_reason";
    return data
      .filter((x) => x.benchmark_id === bm)
      .map((x) => ({
        name: displayName(x.model_id),
        trueAcc: +(x.true_accuracy * 100).toFixed(1),
        falseAcc: +(x.false_accuracy * 100).toFixed(1),
        total: x.total,
      }));
  }, [data, models]);

  if (data.length === 0)
    return <div className="text-[#a1a1aa] py-12 text-center">Loading...</div>;

  return (
    <div className="space-y-6">
      {/* TRUE vs FALSE Accuracy Scatter */}
      <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-6">
        <h3 className="text-sm font-medium text-[#a1a1aa] mb-1">
          TRUE vs FALSE Accuracy — Hard / Default Reasoning
        </h3>
        <p className="text-xs text-[#71717a] mb-4">
          Models above the diagonal are better at TRUE; below are better at FALSE.
          The key insight: most models are biased toward one direction.
        </p>
        <ResponsiveContainer width="100%" height={400}>
          <ScatterChart margin={{ left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              type="number"
              dataKey="trueAcc"
              name="TRUE Accuracy"
              domain={[0, 100]}
              tick={{ fill: "#a1a1aa", fontSize: 12 }}
              label={{ value: "TRUE Accuracy %", position: "bottom", fill: "#a1a1aa", fontSize: 12 }}
            />
            <YAxis
              type="number"
              dataKey="falseAcc"
              name="FALSE Accuracy"
              domain={[0, 100]}
              tick={{ fill: "#a1a1aa", fontSize: 12 }}
              label={{
                value: "FALSE Accuracy %",
                angle: -90,
                position: "insideLeft",
                fill: "#a1a1aa",
                fontSize: 12,
              }}
            />
            <ZAxis range={[60, 60]} />
            <Tooltip
              contentStyle={{
                background: "#18181b",
                border: "1px solid #27272a",
                borderRadius: 8,
                color: "#fafafa",
                fontSize: 13,
              }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any, name: any) => [`${value}%`, name]}
            />
            <Scatter data={scatterData} fill="#6366f1" fillOpacity={0.8}>
              {scatterData.map((entry, i) => (
                <Cell key={i} fill="#818cf8" />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Per-model breakdown */}
      <div className="flex items-center gap-2">
        <label className="text-sm text-[#a1a1aa]">Model:</label>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="bg-[#18181b] border border-[#27272a] rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-[#6366f1]"
        >
          {modelIds.map((id) => (
            <option key={id} value={id}>
              {displayName(id)}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-6">
        <h3 className="text-sm font-medium text-[#a1a1aa] mb-4">
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
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="benchmark" tick={{ fill: "#a1a1aa", fontSize: 12 }} />
            <YAxis domain={[0, 100]} tick={{ fill: "#a1a1aa", fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                background: "#18181b",
                border: "1px solid #27272a",
                borderRadius: 8,
                color: "#fafafa",
                fontSize: 13,
              }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(v: any) => `${v}%`}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Overall" fill="#6366f1" radius={[4, 4, 0, 0]} />
            <Bar dataKey="TRUE" fill="#22c55e" radius={[4, 4, 0, 0]} />
            <Bar dataKey="FALSE" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Summary table */}
      <div className="bg-[#18181b] border border-[#27272a] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#27272a] text-[#a1a1aa]">
              <th className="text-left px-4 py-3 font-medium">Model</th>
              <th className="text-left px-4 py-3 font-medium">Benchmark</th>
              <th className="text-right px-4 py-3 font-medium">Overall</th>
              <th className="text-right px-4 py-3 font-medium">TRUE Acc</th>
              <th className="text-right px-4 py-3 font-medium">FALSE Acc</th>
              <th className="text-right px-4 py-3 font-medium">Bias</th>
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
                    className="border-b border-[#27272a]/50 hover:bg-[#27272a]/30 transition-colors"
                  >
                    <td className="px-4 py-2.5 font-medium">{displayName(row.model_id)}</td>
                    <td className="px-4 py-2.5 text-[#a1a1aa]">
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
                      <span className={bias > 0.1 ? "text-[#22c55e]" : bias < -0.1 ? "text-[#ef4444]" : "text-[#a1a1aa]"}>
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
  );
}

