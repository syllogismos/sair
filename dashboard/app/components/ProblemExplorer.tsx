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
  Cell,
} from "recharts";

interface Problem {
  id: string;
  index: number;
  difficulty: string;
  equation1: string;
  equation2: string;
  answer: boolean;
}

interface ProblemDifficulty {
  problem_id: string;
  equation1: string;
  equation2: string;
  answer: boolean;
  accuracy: number;
  total_runs: number;
  correct_runs: number;
}

export default function ProblemExplorer() {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [difficulty, setDifficulty] = useState<ProblemDifficulty[]>([]);
  const [dataset, setDataset] = useState<"normal" | "hard1" | "hard2">("normal");
  const [filterAnswer, setFilterAnswer] = useState<"all" | "true" | "false">("all");
  const [search, setSearch] = useState("");
  const [selectedProblem, setSelectedProblem] = useState<Problem | null>(null);

  useEffect(() => {
    fetch(`/data/problems_${dataset}.json`)
      .then((r) => r.json())
      .then(setProblems);
    fetch("/data/problem_difficulty.json")
      .then((r) => r.json())
      .then(setDifficulty);
  }, [dataset]);

  const difficultyMap = useMemo(() => {
    const m = new Map<string, ProblemDifficulty>();
    difficulty.forEach((d) => m.set(d.problem_id, d));
    return m;
  }, [difficulty]);

  const filtered = useMemo(() => {
    return problems.filter((p) => {
      if (filterAnswer === "true" && !p.answer) return false;
      if (filterAnswer === "false" && p.answer) return false;
      if (search) {
        const s = search.toLowerCase();
        return (
          p.equation1.toLowerCase().includes(s) ||
          p.equation2.toLowerCase().includes(s) ||
          p.id.toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [problems, filterAnswer, search]);

  // Distribution of model accuracy across problems
  const accuracyDistribution = useMemo(() => {
    const buckets = Array.from({ length: 10 }, (_, i) => ({
      range: `${i * 10}-${(i + 1) * 10}%`,
      count: 0,
      trueCount: 0,
      falseCount: 0,
    }));
    difficulty.forEach((d) => {
      const idx = Math.min(Math.floor(d.accuracy * 10), 9);
      buckets[idx].count++;
      if (d.answer) buckets[idx].trueCount++;
      else buckets[idx].falseCount++;
    });
    return buckets;
  }, [difficulty]);

  const stats = useMemo(() => {
    const trueCount = problems.filter((p) => p.answer).length;
    return {
      total: problems.length,
      trueCount,
      falseCount: problems.length - trueCount,
    };
  }, [problems]);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-[#a1a1aa]">Dataset:</label>
          <select
            value={dataset}
            onChange={(e) => setDataset(e.target.value as typeof dataset)}
            className="bg-[#18181b] border border-[#27272a] rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-[#6366f1]"
          >
            <option value="normal">Normal (1000)</option>
            <option value="hard1">Hard1 (69)</option>
            <option value="hard2">Hard2 (200)</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-[#a1a1aa]">Answer:</label>
          <select
            value={filterAnswer}
            onChange={(e) => setFilterAnswer(e.target.value as typeof filterAnswer)}
            className="bg-[#18181b] border border-[#27272a] rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-[#6366f1]"
          >
            <option value="all">All</option>
            <option value="true">TRUE only</option>
            <option value="false">FALSE only</option>
          </select>
        </div>
        <input
          type="text"
          placeholder="Search equations..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-[#18181b] border border-[#27272a] rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-[#6366f1] w-64"
        />
        <div className="ml-auto flex gap-3 text-sm text-[#a1a1aa]">
          <span>{stats.total} problems</span>
          <span className="text-[#22c55e]">{stats.trueCount} TRUE</span>
          <span className="text-[#ef4444]">{stats.falseCount} FALSE</span>
        </div>
      </div>

      {/* Accuracy distribution chart */}
      <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-6">
        <h3 className="text-sm font-medium text-[#a1a1aa] mb-4">
          Problem Difficulty Distribution (benchmark accuracy across 25 models)
        </h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={accuracyDistribution}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="range" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
            <YAxis tick={{ fill: "#a1a1aa", fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                background: "#18181b",
                border: "1px solid #27272a",
                borderRadius: 8,
                color: "#fafafa",
                fontSize: 13,
              }}
            />
            <Bar dataKey="trueCount" stackId="a" fill="#22c55e" name="TRUE" />
            <Bar dataKey="falseCount" stackId="a" fill="#ef4444" name="FALSE" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Problem list */}
      <div className="bg-[#18181b] border border-[#27272a] rounded-xl overflow-hidden">
        <div className="max-h-[500px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#18181b] z-10">
              <tr className="border-b border-[#27272a] text-[#a1a1aa]">
                <th className="text-left px-4 py-3 font-medium w-28">ID</th>
                <th className="text-left px-4 py-3 font-medium">Equation 1</th>
                <th className="text-left px-4 py-3 font-medium">Equation 2</th>
                <th className="text-center px-4 py-3 font-medium w-20">Answer</th>
                <th className="text-right px-4 py-3 font-medium w-28">Model Acc</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const d = difficultyMap.get(p.id);
                return (
                  <tr
                    key={p.id}
                    className="border-b border-[#27272a]/50 hover:bg-[#27272a]/30 transition-colors cursor-pointer"
                    onClick={() => setSelectedProblem(p)}
                  >
                    <td className="px-4 py-2.5 font-mono text-[#a1a1aa] text-xs">{p.id}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{p.equation1}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{p.equation2}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          p.answer
                            ? "bg-[#22c55e]/10 text-[#22c55e]"
                            : "bg-[#ef4444]/10 text-[#ef4444]"
                        }`}
                      >
                        {p.answer ? "TRUE" : "FALSE"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {d ? (
                        <span
                          className={
                            d.accuracy >= 0.7
                              ? "text-[#22c55e]"
                              : d.accuracy >= 0.5
                                ? "text-[#f59e0b]"
                                : "text-[#ef4444]"
                          }
                        >
                          {(d.accuracy * 100).toFixed(0)}%
                        </span>
                      ) : (
                        <span className="text-[#3f3f46]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected problem detail */}
      {selectedProblem && (
        <div className="bg-[#18181b] border border-[#6366f1]/30 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium">{selectedProblem.id}</h3>
            <button
              onClick={() => setSelectedProblem(null)}
              className="text-[#a1a1aa] hover:text-white text-sm"
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-[#a1a1aa] mb-1">Equation 1</div>
              <div className="font-mono text-sm bg-[#09090b] rounded-lg p-3 border border-[#27272a]">
                {selectedProblem.equation1}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#a1a1aa] mb-1">Equation 2</div>
              <div className="font-mono text-sm bg-[#09090b] rounded-lg p-3 border border-[#27272a]">
                {selectedProblem.equation2}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-4">
            <span className="text-sm text-[#a1a1aa]">
              Does Eq1 imply Eq2?{" "}
              <span
                className={`font-medium ${
                  selectedProblem.answer ? "text-[#22c55e]" : "text-[#ef4444]"
                }`}
              >
                {selectedProblem.answer ? "TRUE" : "FALSE"}
              </span>
            </span>
            {difficultyMap.get(selectedProblem.id) && (
              <span className="text-sm text-[#a1a1aa]">
                Benchmark accuracy:{" "}
                <span className="font-mono">
                  {(difficultyMap.get(selectedProblem.id)!.accuracy * 100).toFixed(1)}%
                </span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
