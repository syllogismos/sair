"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";

// ─── Types ───────────────────────────────────────────────────────────

interface BinFile {
  run_id: string;
  size: number;
  mtime: number;
}

interface TraceEntry {
  i: number;
  selected_program_candidate: number;
  subsample_ids: number[];
  subsample_scores: number[];
  new_subsample_scores?: number[];
  new_program_idx?: number;
  evaluated_val_indices?: number;
  invoked_merge?: boolean;
}

interface ReplayData {
  num_candidates: number;
  num_iterations: number;
  total_metric_calls: number;
  num_val_instances: number;
  candidates: Record<string, string>[];
  aggregate_scores: number[];
  parents: (number | null)[][];
  discovery_calls: number[];
  val_subscores: Record<string, number>[];
  trace: TraceEntry[];
  pareto_front: Record<string, number[]>;
  pareto_scores: Record<string, number>;
  pareto_dominance: number[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// Reusable panel wrapper
function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`replay-panel px-5 py-4 ${className}`}>{children}</div>;
}

function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`replay-panel-header ${className}`}>{children}</span>;
}

function SectionDesc({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] text-zinc-600 leading-relaxed">{children}</p>;
}

function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "success" | "danger" | "info" | "warn" }) {
  const styles: Record<string, string> = {
    default: "bg-zinc-800/80 text-zinc-400 border-zinc-700/60",
    success: "bg-emerald-950/60 text-emerald-400 border-emerald-800/40",
    danger: "bg-red-950/60 text-red-400 border-red-800/40",
    info: "bg-sky-950/60 text-sky-400 border-sky-800/40",
    warn: "bg-amber-950/60 text-amber-400 border-amber-800/40",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-md border ${styles[variant]}`}>
      {children}
    </span>
  );
}

// ─── Main Component ──────────────────────────────────────────────────

export default function GepaReplay() {
  const [bins, setBins] = useState<BinFile[]>([]);
  const [selectedRun, setSelectedRun] = useState<string>("");
  const [data, setData] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  // Animation state
  const [currentStep, setCurrentStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [animPhase, setAnimPhase] = useState<"select" | "subsample" | "compare" | "result" | "fulleval" | "done">("select");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/gepa-replay")
      .then((r) => r.json())
      .then((d) => {
        setBins(d.bins || []);
        if (d.bins?.length > 0) setSelectedRun(d.bins[0].run_id);
      });
  }, []);

  useEffect(() => {
    if (!selectedRun) return;
    setLoading(true);
    setError("");
    setCurrentStep(0);
    setPlaying(false);
    setAnimPhase("select");
    fetch(`/api/gepa-replay?run_id=${selectedRun}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedRun]);

  const advancePhase = useCallback(() => {
    setAnimPhase((prev) => {
      const entry = data?.trace[currentStep];
      if (!entry) return "done";
      switch (prev) {
        case "select": return "subsample";
        case "subsample": return "compare";
        case "compare": return "result";
        case "result":
          if (entry.new_program_idx != null && entry.evaluated_val_indices) return "fulleval";
          return "done";
        case "fulleval": return "done";
        default: return "done";
      }
    });
  }, [data, currentStep]);

  useEffect(() => {
    if (!playing || !data) return;
    if (currentStep >= data.trace.length) {
      setPlaying(false);
      return;
    }
    if (animPhase === "done") {
      timerRef.current = setTimeout(() => {
        if (currentStep < data.trace.length - 1) {
          setCurrentStep((s) => s + 1);
          setAnimPhase("select");
        } else {
          setPlaying(false);
        }
      }, 300 / speed);
    } else {
      phaseTimerRef.current = setTimeout(advancePhase, 600 / speed);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    };
  }, [playing, currentStep, animPhase, speed, data, advancePhase]);

  const goToStep = useCallback((step: number) => {
    if (!data) return;
    setCurrentStep(Math.max(0, Math.min(step, data.trace.length - 1)));
    setAnimPhase("done");
    setPlaying(false);
  }, [data]);

  const togglePlay = () => {
    if (!data) return;
    if (currentStep >= data.trace.length - 1 && animPhase === "done") {
      setCurrentStep(0);
      setAnimPhase("select");
      setPlaying(true);
    } else {
      if (!playing && animPhase === "done") {
        if (currentStep < data.trace.length - 1) {
          setCurrentStep((s) => s + 1);
          setAnimPhase("select");
        }
      }
      setPlaying(!playing);
    }
  };

  const stateAtStep = useMemo(() => {
    if (!data) return null;
    const entry = data.trace[currentStep];
    if (!entry) return null;
    const discoveredCandidates = new Set<number>();
    discoveredCandidates.add(0);
    for (let s = 0; s <= currentStep; s++) {
      const e = data.trace[s];
      if (e.new_program_idx != null) discoveredCandidates.add(e.new_program_idx);
    }
    let bestScore = 0;
    let bestCandidate = 0;
    for (const idx of discoveredCandidates) {
      if (data.aggregate_scores[idx] > bestScore) {
        bestScore = data.aggregate_scores[idx];
        bestCandidate = idx;
      }
    }
    const metricCalls = entry.new_program_idx != null
      ? data.discovery_calls[entry.new_program_idx] || 0
      : (currentStep > 0 ? data.discovery_calls[Math.max(...Array.from(discoveredCandidates))] : 0);
    return { entry, discoveredCandidates, bestScore, bestCandidate, metricCalls };
  }, [data, currentStep]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-sky-500 rounded-full animate-spin" />
        <span className="text-xs text-zinc-500 tracking-wide uppercase">Loading state...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-400/80 text-sm bg-red-950/20 border border-red-900/30 rounded-lg px-6 py-4">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── File Picker ── */}
      <Panel>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-sky-500 shadow-[0_0_6px_rgba(56,189,248,0.4)]" />
            <span className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">Replay</span>
          </div>
          <select
            value={selectedRun}
            onChange={(e) => setSelectedRun(e.target.value)}
            className="flex-1 bg-[#0c0c0f] border border-[#1e1e24] rounded-lg px-3 py-2 text-sm text-zinc-300 font-mono focus:outline-none focus:border-sky-800 transition-colors"
          >
            {bins.map((b) => (
              <option key={b.run_id} value={b.run_id}>
                {b.run_id} — {formatSize(b.size)} — {formatDate(b.mtime)}
              </option>
            ))}
          </select>
          {data && (
            <div className="flex gap-3">
              {[
                [`${data.num_candidates}`, "candidates"],
                [`${data.trace.length}`, "iterations"],
                [data.total_metric_calls.toLocaleString(), "evals"],
                [`${data.num_val_instances}`, "val inst."],
              ].map(([val, label]) => (
                <div key={label} className="text-center">
                  <div className="text-xs font-mono text-zinc-300">{val}</div>
                  <div className="text-[9px] text-zinc-600 uppercase tracking-wider">{label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      {data && stateAtStep && (
        <>
          {/* ── Playback Controls ── */}
          <PlaybackControls
            currentStep={currentStep}
            totalSteps={data.trace.length}
            playing={playing}
            speed={speed}
            animPhase={animPhase}
            onTogglePlay={togglePlay}
            onSetSpeed={setSpeed}
            onGoToStep={goToStep}
            onStepForward={() => { if (currentStep < data.trace.length - 1) { setCurrentStep((s) => s + 1); setAnimPhase("done"); } }}
            onStepBack={() => { if (currentStep > 0) { setCurrentStep((s) => s - 1); setAnimPhase("done"); } }}
          />

          {/* ── Main Layout ── */}
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-5 space-y-3">
              <CandidateTree
                data={data}
                currentStep={currentStep}
                discoveredCandidates={stateAtStep.discoveredCandidates}
                selectedParent={stateAtStep.entry.selected_program_candidate}
                newCandidate={animPhase === "result" || animPhase === "fulleval" || animPhase === "done" ? stateAtStep.entry.new_program_idx : undefined}
                animPhase={animPhase}
              />
              <IterationDetail data={data} entry={stateAtStep.entry} animPhase={animPhase} />
            </div>
            <div className="col-span-7 space-y-3">
              <MinibatchView entry={stateAtStep.entry} animPhase={animPhase} />
              <CandidateScoreChart
                data={data}
                discoveredCandidates={stateAtStep.discoveredCandidates}
                currentNewCandidate={stateAtStep.entry.new_program_idx}
                animPhase={animPhase}
              />
            </div>
          </div>

          <FullValEvaluation data={data} entry={stateAtStep.entry} animPhase={animPhase} />
          <CandidateInstanceHeatmap
            data={data}
            discoveredCandidates={stateAtStep.discoveredCandidates}
            highlightCandidate={stateAtStep.entry.new_program_idx}
            parentCandidate={stateAtStep.entry.selected_program_candidate}
          />
          <CandidateInstructions
            data={data}
            discoveredCandidates={stateAtStep.discoveredCandidates}
            highlightCandidate={stateAtStep.entry.new_program_idx}
          />
        </>
      )}
    </div>
  );
}

// ─── Playback Controls ──────────────────────────────────────────────

function PlaybackControls({
  currentStep, totalSteps, playing, speed, animPhase,
  onTogglePlay, onSetSpeed, onGoToStep, onStepForward, onStepBack,
}: {
  currentStep: number; totalSteps: number; playing: boolean; speed: number; animPhase: string;
  onTogglePlay: () => void; onSetSpeed: (s: number) => void; onGoToStep: (s: number) => void;
  onStepForward: () => void; onStepBack: () => void;
}) {
  const phases = ["select", "subsample", "compare", "result", "fulleval", "done"];
  const phaseLabels: Record<string, string> = {
    select: "Parent", subsample: "Minibatch", compare: "Compare",
    result: "Decision", fulleval: "Full Eval", done: "Done",
  };

  return (
    <Panel>
      <div className="flex items-center gap-3">
        {/* Transport controls */}
        <div className="flex items-center gap-1 bg-[#0c0c0f] rounded-lg p-1 border border-[#1e1e24]">
          <button onClick={onStepBack} disabled={currentStep === 0}
            className="w-8 h-8 flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-20 disabled:cursor-not-allowed transition-colors text-sm">
            &#x23EE;
          </button>
          <button onClick={onTogglePlay}
            className="w-10 h-8 flex items-center justify-center rounded-md font-semibold text-xs transition-all"
            style={{
              background: playing ? "linear-gradient(135deg, #dc2626, #b91c1c)" : "linear-gradient(135deg, #0ea5e9, #0284c7)",
              color: "#fff",
              boxShadow: playing ? "0 0 10px rgba(220,38,38,0.3)" : "0 0 10px rgba(14,165,233,0.3)",
            }}>
            {playing ? "||" : "\u25B6"}
          </button>
          <button onClick={onStepForward} disabled={currentStep >= totalSteps - 1}
            className="w-8 h-8 flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-20 disabled:cursor-not-allowed transition-colors text-sm">
            &#x23ED;
          </button>
        </div>

        {/* Timeline */}
        <div className="flex-1 flex flex-col gap-1">
          <input
            type="range" min={0} max={totalSteps - 1} value={currentStep}
            onChange={(e) => onGoToStep(parseInt(e.target.value))}
            className="replay-slider w-full"
          />
          {/* Phase pips */}
          <div className="flex items-center gap-1 px-0.5">
            {phases.map((p) => {
              const isActive = animPhase === p;
              const isPast = phases.indexOf(animPhase) > phases.indexOf(p);
              return (
                <div key={p} className="flex items-center gap-1">
                  <div className={`w-1.5 h-1.5 rounded-full transition-all ${
                    isActive ? "bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.6)] phase-active" :
                    isPast ? "bg-sky-700" : "bg-zinc-800"
                  }`} />
                  <span className={`text-[8px] tracking-wider uppercase ${
                    isActive ? "text-sky-400" : isPast ? "text-zinc-600" : "text-zinc-800"
                  }`}>{phaseLabels[p]}</span>
                  {p !== "done" && <div className={`w-3 h-px ${isPast ? "bg-sky-800" : "bg-zinc-800"}`} />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Iteration counter */}
        <div className="text-right min-w-[90px]">
          <div className="font-mono text-lg leading-none text-zinc-200 tabular-nums">
            {String(currentStep).padStart(2, "0")}
            <span className="text-zinc-700 text-sm">/{totalSteps - 1}</span>
          </div>
          <div className="text-[8px] tracking-widest text-zinc-600 uppercase mt-0.5">iteration</div>
        </div>

        {/* Speed */}
        <div className="flex flex-col items-center gap-1">
          <div className="flex gap-0.5 bg-[#0c0c0f] rounded-md p-0.5 border border-[#1e1e24]">
            {[0.25, 0.5, 1, 2].map((s) => (
              <button key={s} onClick={() => onSetSpeed(s)}
                className={`px-2 py-1 text-[10px] font-mono rounded transition-all ${
                  speed === s
                    ? "bg-sky-900/60 text-sky-300 shadow-[0_0_8px_rgba(56,189,248,0.15)]"
                    : "text-zinc-600 hover:text-zinc-400"
                }`}>
                {s}x
              </button>
            ))}
          </div>
          <span className="text-[8px] tracking-widest text-zinc-700 uppercase">speed</span>
        </div>
      </div>
    </Panel>
  );
}

// ─── Candidate Tree ─────────────────────────────────────────────────

function CandidateTree({
  data, currentStep, discoveredCandidates, selectedParent, newCandidate, animPhase,
}: {
  data: ReplayData; currentStep: number; discoveredCandidates: Set<number>;
  selectedParent: number; newCandidate?: number; animPhase: string;
}) {
  const nodes = Array.from(discoveredCandidates).sort((a, b) => a - b);
  const depths: Record<number, number> = {};
  function getDepth(idx: number): number {
    if (depths[idx] !== undefined) return depths[idx];
    const parentList = data.parents[idx];
    if (!parentList || parentList[0] == null) { depths[idx] = 0; return 0; }
    depths[idx] = getDepth(parentList[0]) + 1;
    return depths[idx];
  }
  nodes.forEach(getDepth);
  const maxDepth = Math.max(...nodes.map((n) => depths[n] || 0), 0);

  const byDepth: Record<number, number[]> = {};
  for (const n of nodes) {
    const d = depths[n] || 0;
    if (!byDepth[d]) byDepth[d] = [];
    byDepth[d].push(n);
  }

  const nodeWidth = 74;
  const nodeHeight = 44;
  const levelGap = 64;
  const nodeGap = 12;

  const positions: Record<number, { x: number; y: number }> = {};
  for (let d = 0; d <= maxDepth; d++) {
    const group = byDepth[d] || [];
    const totalWidth = group.length * nodeWidth + (group.length - 1) * nodeGap;
    const startX = (500 - totalWidth) / 2;
    group.forEach((n, i) => {
      positions[n] = {
        x: startX + i * (nodeWidth + nodeGap) + nodeWidth / 2,
        y: d * levelGap + nodeHeight / 2 + 16,
      };
    });
  }

  const svgHeight = (maxDepth + 1) * levelGap + 36;

  return (
    <Panel>
      <div className="mb-3">
        <SectionLabel>Candidate Tree</SectionLabel>
        <SectionDesc>Parent→child lineage of prompt candidates. Each node is a mutated variant of its parent.</SectionDesc>
      </div>
      <svg width="100%" viewBox={`0 0 500 ${svgHeight}`} className="overflow-visible">
        <defs>
          <filter id="glow-cyan"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <filter id="glow-amber"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <linearGradient id="edge-new" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#38bdf8" stopOpacity="0.6" /><stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.3" /></linearGradient>
        </defs>

        {/* Edges */}
        {nodes.map((n) => {
          const parentList = data.parents[n];
          if (!parentList || parentList[0] == null) return null;
          const parent = parentList[0];
          if (!positions[parent] || !positions[n]) return null;
          const isNewEdge = n === newCandidate;
          return (
            <line key={`edge-${parent}-${n}`}
              x1={positions[parent].x} y1={positions[parent].y + nodeHeight / 2}
              x2={positions[n].x} y2={positions[n].y - nodeHeight / 2}
              stroke={isNewEdge ? "url(#edge-new)" : "#222228"}
              strokeWidth={isNewEdge ? 2 : 1}
              strokeDasharray={isNewEdge && (animPhase === "result" || animPhase === "fulleval") ? "6,4" : undefined}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((n) => {
          const pos = positions[n];
          if (!pos) return null;
          const isParent = n === selectedParent;
          const isNew = n === newCandidate;
          const score = data.aggregate_scores[n];
          const isBest = score === Math.max(...Array.from(discoveredCandidates).map((c) => data.aggregate_scores[c]));

          let fill = "#161619";
          let stroke = "#222228";
          let textColor = "#71717a";
          let scoreColor = "#52525b";
          let filter = "";

          if (isNew && (animPhase === "result" || animPhase === "fulleval" || animPhase === "done")) {
            fill = "#0c2d48"; stroke = "#0ea5e9"; textColor = "#7dd3fc"; scoreColor = "#38bdf8"; filter = "url(#glow-cyan)";
          } else if (isParent && animPhase !== "done") {
            fill = "#2a1f05"; stroke = "#d97706"; textColor = "#fbbf24"; scoreColor = "#f59e0b"; filter = "url(#glow-amber)";
          } else if (isBest) {
            fill = "#052e16"; stroke = "#16a34a"; textColor = "#4ade80"; scoreColor = "#22c55e";
          }

          return (
            <g key={`node-${n}`}>
              <rect x={pos.x - nodeWidth / 2} y={pos.y - nodeHeight / 2}
                width={nodeWidth} height={nodeHeight} rx={10}
                fill={fill} stroke={stroke} strokeWidth={(isParent || isNew) ? 1.5 : 0.5}
                filter={filter}
              />
              <text x={pos.x} y={pos.y - 5} textAnchor="middle" fill={textColor} fontSize={12} fontWeight={700} fontFamily="var(--font-geist-mono)">
                C{n}
              </text>
              <text x={pos.x} y={pos.y + 12} textAnchor="middle" fill={scoreColor} fontSize={10} fontFamily="var(--font-geist-mono)">
                {(score * 100).toFixed(1)}%
              </text>
            </g>
          );
        })}
      </svg>

      <div className="flex gap-4 mt-3 pt-3 border-t border-[#1e1e24]">
        {[
          ["#d97706", "#2a1f05", "Selected parent"],
          ["#0ea5e9", "#0c2d48", "New candidate"],
          ["#16a34a", "#052e16", "Best overall"],
        ].map(([border, bg, label]) => (
          <span key={label} className="flex items-center gap-1.5 text-[9px] text-zinc-600 uppercase tracking-wider">
            <span className="w-3 h-3 rounded-[4px]" style={{ border: `1.5px solid ${border}`, background: bg }} />
            {label}
          </span>
        ))}
      </div>
    </Panel>
  );
}

// ─── Iteration Detail ───────────────────────────────────────────────

function IterationDetail({ data, entry, animPhase }: { data: ReplayData; entry: TraceEntry; animPhase: string }) {
  const wasAccepted = entry.new_program_idx != null;
  const parentScore = data.aggregate_scores[entry.selected_program_candidate];
  const subsampleOld = entry.subsample_scores;
  const subsampleNew = entry.new_subsample_scores;
  const oldAvg = subsampleOld.reduce((a, b) => a + b, 0) / subsampleOld.length;
  const newAvg = subsampleNew ? subsampleNew.reduce((a, b) => a + b, 0) / subsampleNew.length : 0;

  return (
    <Panel>
      <div className="flex items-center justify-between mb-4">
        <SectionLabel>Iteration {entry.i}</SectionLabel>
        <div className="flex items-center gap-1.5">
          {entry.invoked_merge && <Badge variant="warn">merge</Badge>}
          {(animPhase === "result" || animPhase === "fulleval" || animPhase === "done") && (
            <Badge variant={wasAccepted ? "success" : "danger"}>
              {wasAccepted ? `Accepted → C${entry.new_program_idx}` : "Rejected"}
            </Badge>
          )}
        </div>
      </div>

      <div className="space-y-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-zinc-600 text-[10px] uppercase tracking-wider w-14">Parent</span>
          <span className="font-mono text-amber-400">C{entry.selected_program_candidate}</span>
          <span className="text-zinc-600 font-mono">{(parentScore * 100).toFixed(1)}%</span>
        </div>

        {animPhase !== "select" && (
          <div className="flex items-center gap-2">
            <span className="text-zinc-600 text-[10px] uppercase tracking-wider w-14">Batch</span>
            <span className="font-mono text-zinc-400">{(oldAvg * 100).toFixed(0)}%</span>
            {subsampleNew && subsampleNew.length > 0 && (
              <>
                <span className="text-zinc-700">→</span>
                <span className={`font-mono ${newAvg >= oldAvg ? "text-emerald-400" : "text-red-400"}`}>
                  {(newAvg * 100).toFixed(0)}%
                </span>
                <span className={`font-mono text-[10px] ${newAvg > oldAvg ? "text-emerald-600" : newAvg < oldAvg ? "text-red-600" : "text-zinc-700"}`}>
                  {newAvg > oldAvg ? "+" : ""}{((newAvg - oldAvg) * 100).toFixed(0)}pp
                </span>
              </>
            )}
          </div>
        )}

        {wasAccepted && (animPhase === "fulleval" || animPhase === "done") && (
          <div className="flex items-center gap-2">
            <span className="text-zinc-600 text-[10px] uppercase tracking-wider w-14">Val</span>
            <span className="font-mono text-zinc-500">{entry.evaluated_val_indices} inst.</span>
            <span className="text-zinc-700">→</span>
            <span className="font-mono text-emerald-400">{(data.aggregate_scores[entry.new_program_idx!] * 100).toFixed(1)}%</span>
          </div>
        )}
      </div>
    </Panel>
  );
}

// ─── Minibatch View ─────────────────────────────────────────────────

function MinibatchView({ entry, animPhase }: { entry: TraceEntry; animPhase: string }) {
  const showNew = animPhase !== "select" && animPhase !== "subsample";

  return (
    <Panel>
      <div className="flex items-center justify-between mb-1">
        <SectionLabel>Minibatch Evaluation</SectionLabel>
        <span className="text-[10px] text-zinc-600 font-mono">{entry.subsample_ids.length} examples</span>
      </div>
      <SectionDesc>Quick check on a small random sample of training problems. The parent&apos;s prompt and the proposed new prompt are both scored on this batch. If the new prompt does better, it advances to full evaluation.</SectionDesc>
      <div className="mb-3" />

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#1e1e24]">
              <th className="py-2 px-2 text-left font-normal text-[10px] text-zinc-600 uppercase tracking-wider">#</th>
              <th className="py-2 px-2 text-left font-normal text-[10px] text-zinc-600 uppercase tracking-wider">ID</th>
              <th className="py-2 px-2 text-center font-normal text-[10px] text-zinc-600 uppercase tracking-wider">Parent</th>
              {showNew && entry.new_subsample_scores && (
                <th className="py-2 px-2 text-center font-normal text-[10px] text-zinc-600 uppercase tracking-wider">New</th>
              )}
              {showNew && entry.new_subsample_scores && (
                <th className="py-2 px-2 text-center font-normal text-[10px] text-zinc-600 uppercase tracking-wider">Δ</th>
              )}
            </tr>
          </thead>
          <tbody>
            {entry.subsample_ids.map((id, i) => {
              const oldScore = entry.subsample_scores[i];
              const newScore = entry.new_subsample_scores?.[i];
              const delta = newScore != null ? newScore - oldScore : null;
              return (
                <tr key={i} className="border-b border-[#1e1e24]/50 transition-all duration-200 hover:bg-white/[0.01]">
                  <td className="py-1.5 px-2 text-zinc-700 font-mono">{i + 1}</td>
                  <td className="py-1.5 px-2 font-mono text-zinc-500">{id}</td>
                  <td className="py-1.5 px-2 text-center">
                    <ScorePip value={oldScore >= 1} />
                  </td>
                  {showNew && entry.new_subsample_scores && (
                    <td className="py-1.5 px-2 text-center">
                      {newScore != null ? <ScorePip value={newScore >= 1} /> : <span className="text-zinc-800">-</span>}
                    </td>
                  )}
                  {showNew && entry.new_subsample_scores && (
                    <td className="py-1.5 px-2 text-center">
                      {delta != null && delta !== 0 ? (
                        <span className={`font-mono text-[10px] ${delta > 0 ? "text-emerald-500" : "text-red-500"}`}>
                          {delta > 0 ? "+1" : "-1"}
                        </span>
                      ) : <span className="text-zinc-800">=</span>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ScorePip({ value }: { value: boolean }) {
  return (
    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md text-[10px] font-mono font-bold ${
      value
        ? "bg-emerald-500/15 text-emerald-400 shadow-[inset_0_0_4px_rgba(16,185,129,0.15)]"
        : "bg-red-500/10 text-red-500/60 shadow-[inset_0_0_4px_rgba(239,68,68,0.1)]"
    }`}>
      {value ? "1" : "0"}
    </span>
  );
}

// ─── Candidate Score Chart ──────────────────────────────────────────

function CandidateScoreChart({
  data, discoveredCandidates, currentNewCandidate, animPhase,
}: {
  data: ReplayData; discoveredCandidates: Set<number>; currentNewCandidate?: number; animPhase: string;
}) {
  const candidates = Array.from(discoveredCandidates).sort((a, b) => a - b);
  const maxScore = Math.max(...candidates.map((c) => data.aggregate_scores[c]));

  return (
    <Panel>
      <div className="mb-1"><SectionLabel>Candidate Performance</SectionLabel></div>
      <SectionDesc>Accuracy of each discovered candidate on the full validation set (253 instances).</SectionDesc>
      <div className="mt-3 space-y-2">
        {candidates.map((c) => {
          const score = data.aggregate_scores[c];
          const pct = score * 100;
          const isNew = c === currentNewCandidate && (animPhase === "result" || animPhase === "fulleval");
          const isBest = score === maxScore;

          const barGradient = isBest
            ? "linear-gradient(90deg, #065f46, #059669)"
            : isNew
            ? "linear-gradient(90deg, #0c4a6e, #0284c7)"
            : score >= 0.8
            ? "linear-gradient(90deg, #1e293b, #334155)"
            : "linear-gradient(90deg, #18181b, #27272a)";

          return (
            <div key={c} className="flex items-center gap-2.5">
              <span className={`text-[10px] font-mono w-7 text-right font-semibold ${
                isNew ? "text-sky-400" : isBest ? "text-emerald-400" : "text-zinc-600"
              }`}>
                C{c}
              </span>
              <div className="flex-1 h-6 bg-[#0c0c0f] rounded-lg overflow-hidden relative border border-[#1e1e24]">
                <div
                  className={`h-full rounded-lg transition-all duration-700 ease-out ${isNew ? "animate-pulse" : ""}`}
                  style={{ width: `${pct}%`, background: barGradient }}
                />
                <span className="absolute right-2.5 top-0 h-full flex items-center text-[10px] font-mono text-zinc-500">
                  {pct.toFixed(1)}%
                </span>
              </div>
              <span className="text-[9px] text-zinc-700 font-mono w-14 text-right">
                {data.discovery_calls[c]?.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ─── Full Val Evaluation ────────────────────────────────────────────

function FullValEvaluation({ data, entry, animPhase }: { data: ReplayData; entry: TraceEntry; animPhase: string }) {
  const [filterMode, setFilterMode] = useState<"all" | "gained" | "lost" | "disagree">("disagree");
  const wasAccepted = entry.new_program_idx != null;

  const newIdx = wasAccepted ? entry.new_program_idx! : 0;
  const parentIdx = entry.selected_program_candidate;
  const newScores = wasAccepted ? (data.val_subscores[newIdx] || {}) : {};
  const parentScores = data.val_subscores[parentIdx] || {};

  const allKeys = Object.keys(wasAccepted ? newScores : parentScores).sort((a, b) => Number(a) - Number(b));
  const gained: string[] = [];
  const lost: string[] = [];
  const bothCorrect: string[] = [];
  const bothWrong: string[] = [];

  if (wasAccepted) {
    for (const k of allKeys) {
      const pScore = parentScores[k] ?? 0;
      const nScore = newScores[k] ?? 0;
      if (nScore >= 1 && pScore < 1) gained.push(k);
      else if (nScore < 1 && pScore >= 1) lost.push(k);
      else if (nScore >= 1 && pScore >= 1) bothCorrect.push(k);
      else bothWrong.push(k);
    }
  }

  const filteredKeys = filterMode === "all" ? allKeys : filterMode === "gained" ? gained : filterMode === "lost" ? lost : [...gained, ...lost];
  const newTotal = wasAccepted ? Object.values(newScores).filter((v) => v >= 1).length : 0;
  const parentTotal = Object.values(parentScores).filter((v) => v >= 1).length;

  const filterButtons = [
    { key: "disagree" as const, label: "Disagreements", count: gained.length + lost.length, variant: "info" },
    { key: "gained" as const, label: "Gained", count: gained.length, variant: "success" },
    { key: "lost" as const, label: "Lost", count: lost.length, variant: "danger" },
    { key: "all" as const, label: "All", count: allKeys.length, variant: "default" },
  ];

  return (
    <Panel>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <SectionLabel>Full Validation</SectionLabel>
          {wasAccepted ? (
            <span className="text-[10px] text-zinc-600 font-mono">C{parentIdx} → C{newIdx}</span>
          ) : (
            <span className="text-[10px] text-zinc-600 font-mono">from C{parentIdx}</span>
          )}
        </div>
        {wasAccepted ? (
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-zinc-500">{parentTotal}/{allKeys.length}</span>
            <span className="text-zinc-700">→</span>
            <span className={newTotal > parentTotal ? "text-emerald-400" : newTotal < parentTotal ? "text-red-400" : "text-zinc-400"}>
              {newTotal}/{allKeys.length}
            </span>
            <span className={`text-[10px] ${newTotal - parentTotal > 0 ? "text-emerald-600" : newTotal - parentTotal < 0 ? "text-red-600" : "text-zinc-700"}`}>
              ({newTotal - parentTotal > 0 ? "+" : ""}{newTotal - parentTotal})
            </span>
          </div>
        ) : (
          <Badge variant="danger">Rejected</Badge>
        )}
      </div>
      <SectionDesc>When a candidate passes the minibatch check, it&apos;s evaluated on all {allKeys.length} validation instances. This shows which problems it gained or lost vs. its parent.</SectionDesc>
      <div className="mb-3" />

      <div className="h-[340px] flex flex-col">
        {!wasAccepted ? (
          <div className="flex-1 flex items-center justify-center text-xs text-zinc-700">
            No full evaluation — candidate rejected at minibatch stage
          </div>
        ) : (
          <>
            <div className="flex gap-1.5 mb-3 shrink-0">
              {filterButtons.map(({ key, label, count, variant }) => (
                <button key={key} onClick={() => setFilterMode(key)}
                  className={`px-2.5 py-1 text-[10px] font-medium rounded-md border transition-all ${
                    filterMode === key
                      ? variant === "info" ? "bg-sky-950/50 text-sky-300 border-sky-800/50"
                      : variant === "success" ? "bg-emerald-950/50 text-emerald-300 border-emerald-800/50"
                      : variant === "danger" ? "bg-red-950/50 text-red-300 border-red-800/50"
                      : "bg-zinc-800/50 text-zinc-300 border-zinc-700/50"
                      : "border-[#1e1e24] text-zinc-600 hover:text-zinc-400 hover:border-zinc-700"
                  }`}>
                  {label} <span className="ml-1 opacity-60">{count}</span>
                </button>
              ))}
              <div className="flex-1" />
              <div className="flex items-center gap-3 text-[9px] text-zinc-700 uppercase tracking-wider">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-800/50 inline-block" /> correct</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-800/30 inline-block" /> wrong</span>
              </div>
            </div>

            <div className="flex-1 min-h-0">
              {filterMode === "all" ? (
                <InstancePixelGrid allKeys={allKeys} parentScores={parentScores} newScores={newScores} />
              ) : (
                <div className="h-full overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0" style={{ background: "linear-gradient(180deg, #141417, #111114)" }}>
                      <tr className="border-b border-[#1e1e24]">
                        <th className="py-2 px-2 text-left font-normal text-[10px] text-zinc-600 uppercase tracking-wider w-20">Idx</th>
                        <th className="py-2 px-2 text-center font-normal text-[10px] text-zinc-600 uppercase tracking-wider">C{parentIdx}</th>
                        <th className="py-2 px-2 text-center font-normal text-[10px] text-zinc-600 uppercase tracking-wider">C{newIdx}</th>
                        <th className="py-2 px-2 text-center font-normal text-[10px] text-zinc-600 uppercase tracking-wider">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredKeys.map((k) => {
                        const pScore = parentScores[k] ?? 0;
                        const nScore = newScores[k] ?? 0;
                        const isGained = nScore >= 1 && pScore < 1;
                        const isLost = nScore < 1 && pScore >= 1;
                        return (
                          <tr key={k} className="border-b border-[#1e1e24]/50 hover:bg-white/[0.01] transition-colors">
                            <td className="py-1.5 px-2 font-mono text-zinc-500">{k}</td>
                            <td className="py-1.5 px-2 text-center"><ScorePip value={pScore >= 1} /></td>
                            <td className="py-1.5 px-2 text-center"><ScorePip value={nScore >= 1} /></td>
                            <td className="py-1.5 px-2 text-center">
                              {isGained && <span className="text-emerald-500 font-mono text-[10px]">+1 gained</span>}
                              {isLost && <span className="text-red-500 font-mono text-[10px]">-1 lost</span>}
                              {!isGained && !isLost && <span className="text-zinc-800">=</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

function InstancePixelGrid({ allKeys, parentScores, newScores }: {
  allKeys: string[]; parentScores: Record<string, number>; newScores: Record<string, number>;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-2 text-[9px] text-zinc-600 uppercase tracking-wider">
        <span>Per instance:</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-400 inline-block" /> gained</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-400 inline-block" /> lost</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-900/60 inline-block" /> both ok</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-900/40 inline-block" /> both wrong</span>
      </div>
      <div className="flex flex-wrap gap-[2px]">
        {allKeys.map((k) => {
          const p = (parentScores[k] ?? 0) >= 1;
          const n = (newScores[k] ?? 0) >= 1;
          let color = "bg-red-900/40";
          if (n && !p) color = "bg-emerald-400";
          else if (!n && p) color = "bg-red-400";
          else if (n && p) color = "bg-emerald-900/60";
          return (
            <div key={k} className={`w-[6px] h-[6px] rounded-[1px] ${color}`}
              title={`val_idx ${k}: parent=${p ? 1 : 0} new=${n ? 1 : 0}`} />
          );
        })}
      </div>
    </div>
  );
}

// ─── Candidate Instance Heatmap ─────────────────────────────────────

function CandidateInstanceHeatmap({
  data, discoveredCandidates, highlightCandidate, parentCandidate,
}: {
  data: ReplayData; discoveredCandidates: Set<number>; highlightCandidate?: number; parentCandidate: number;
}) {
  const [hoveredInstance, setHoveredInstance] = useState<string | null>(null);
  const [showOnlyDisagreements, setShowOnlyDisagreements] = useState(true);

  const candidates = Array.from(discoveredCandidates).sort((a, b) => a - b);
  const allKeys = Object.keys(data.val_subscores[0] || {}).sort((a, b) => Number(a) - Number(b));

  const disagreementKeys = useMemo(() => {
    return allKeys.filter((k) => {
      const scores = candidates.map((c) => (data.val_subscores[c]?.[k] ?? 0) >= 1 ? 1 : 0);
      return scores.some((s) => s !== scores[0]);
    });
  }, [allKeys, candidates, data.val_subscores]);

  const displayKeys = showOnlyDisagreements ? disagreementKeys : allKeys;

  const sortedKeys = useMemo(() => {
    return [...displayKeys].sort((a, b) => {
      const aCorrect = candidates.filter((c) => (data.val_subscores[c]?.[a] ?? 0) >= 1).length;
      const bCorrect = candidates.filter((c) => (data.val_subscores[c]?.[b] ?? 0) >= 1).length;
      return aCorrect - bCorrect;
    });
  }, [displayKeys, candidates, data.val_subscores]);

  return (
    <Panel>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <SectionLabel>Instance Heatmap</SectionLabel>
          <span className="text-[10px] text-zinc-700 font-mono">{candidates.length}C × {displayKeys.length} inst.</span>
        </div>
        <button onClick={() => setShowOnlyDisagreements(!showOnlyDisagreements)}
          className={`px-2.5 py-1 text-[10px] font-medium rounded-md border transition-all ${
            showOnlyDisagreements
              ? "bg-sky-950/50 text-sky-300 border-sky-800/50"
              : "border-[#1e1e24] text-zinc-600 hover:text-zinc-400"
          }`}>
          {showOnlyDisagreements ? `Disagreements (${disagreementKeys.length})` : `All (${allKeys.length})`}
        </button>
      </div>
      <SectionDesc>Each row is a candidate, each column a validation problem. Green = correct, red = wrong. Sorted left-to-right by hardness (fewest solvers first).</SectionDesc>
      <div className="mb-3" />

      <div className="overflow-x-auto">
        <div className="min-w-fit">
          {candidates.map((c) => {
            const scores = data.val_subscores[c] || {};
            const isHighlight = c === highlightCandidate;
            const isParent = c === parentCandidate;
            return (
              <div key={c} className="flex items-center mb-[2px]">
                <div className={`w-12 shrink-0 text-[10px] font-mono pr-2 text-right font-semibold ${
                  isHighlight ? "text-sky-400" : isParent ? "text-amber-400" : "text-zinc-700"
                }`}>
                  C{c}
                </div>
                <div className="flex gap-[1px]">
                  {sortedKeys.map((k) => {
                    const correct = (scores[k] ?? 0) >= 1;
                    return (
                      <div key={k}
                        className={`w-[5px] h-[14px] rounded-[2px] cursor-pointer transition-all ${
                          correct ? "bg-emerald-500/80" : "bg-red-500/25"
                        } ${hoveredInstance === k ? "ring-1 ring-white/70 scale-y-110" : "hover:brightness-125"}`}
                        onMouseEnter={() => setHoveredInstance(k)}
                        onMouseLeave={() => setHoveredInstance(null)}
                      />
                    );
                  })}
                </div>
                <div className="ml-2.5 text-[10px] text-zinc-700 font-mono whitespace-nowrap">
                  {Object.values(scores).filter((v) => v >= 1).length}<span className="text-zinc-800">/{Object.keys(scores).length}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="h-7 mt-2">
        {hoveredInstance ? (
          <div className="text-xs text-zinc-500 bg-[#0c0c0f] rounded-md px-3 py-1.5 border border-[#1e1e24] font-mono">
            <span className="text-zinc-600 text-[10px] uppercase tracking-wider mr-2">idx {hoveredInstance}</span>
            {candidates.map((c) => {
              const score = (data.val_subscores[c]?.[hoveredInstance] ?? 0) >= 1;
              return (
                <span key={c} className={`mx-1 ${score ? "text-emerald-400" : "text-red-500/60"}`}>
                  C{c}={score ? "1" : "0"}
                </span>
              );
            })}
          </div>
        ) : (
          <div className="text-[9px] text-zinc-700 px-3 py-1.5 uppercase tracking-wider">Hover a column for detail</div>
        )}
      </div>
    </Panel>
  );
}

// ─── Candidate Instructions ─────────────────────────────────────────

function CandidateInstructions({ data, discoveredCandidates, highlightCandidate }: {
  data: ReplayData; discoveredCandidates: Set<number>; highlightCandidate?: number;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const candidates = Array.from(discoveredCandidates).sort((a, b) => a - b);

  return (
    <Panel>
      <div className="mb-1"><SectionLabel>Instructions</SectionLabel></div>
      <SectionDesc>The actual prompt text given to the student LM for each candidate. Click to expand.</SectionDesc>
      <div className="mt-3 space-y-0.5">
        {candidates.map((c) => {
          const instructions = data.candidates[c];
          const isHighlighted = c === highlightCandidate;
          const isExpanded = expanded === c;
          const score = data.aggregate_scores[c];
          const parent = data.parents[c]?.[0];

          return (
            <div key={c}>
              <button
                onClick={() => setExpanded(isExpanded ? null : c)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-xs flex items-center gap-3 transition-all ${
                  isHighlighted
                    ? "bg-sky-950/30 border border-sky-800/30"
                    : isExpanded
                    ? "bg-white/[0.02] border border-[#1e1e24]"
                    : "border border-transparent hover:bg-white/[0.015]"
                }`}
              >
                <span className={`font-mono font-semibold w-7 ${isHighlighted ? "text-sky-400" : "text-zinc-600"}`}>C{c}</span>
                <span className={`font-mono tabular-nums ${score >= 0.85 ? "text-emerald-400" : score >= 0.8 ? "text-sky-400" : "text-zinc-500"}`}>
                  {(score * 100).toFixed(1)}%
                </span>
                <span className="text-zinc-700 font-mono text-[10px]">
                  {parent != null ? `← C${parent}` : "seed"}
                </span>
                <span className="text-zinc-700 ml-auto text-[10px]">{isExpanded ? "▾" : "▸"}</span>
              </button>
              {isExpanded && instructions && (
                <div className="ml-10 mt-1.5 mb-2.5">
                  {Object.entries(instructions).map(([name, text]) => (
                    <div key={name} className="mb-2">
                      <div className="text-[9px] text-zinc-600 mb-1 uppercase tracking-wider">{name}</div>
                      <pre className="text-[11px] text-zinc-400 bg-[#0c0c0f] rounded-lg p-4 border border-[#1e1e24] whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto leading-relaxed">
                        {text}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
