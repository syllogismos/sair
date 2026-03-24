"use client";

import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import LeaderboardView from "./components/LeaderboardView";
import ModelBreakdownView from "./components/ModelBreakdownView";
import ProblemExplorer from "./components/ProblemExplorer";
import RunsExplorer from "./components/RunsExplorer";
import GepaExperiments from "./components/GepaExperiments";
import AutoResearchView from "./components/AutoResearchView";
import GepaReplay from "./components/GepaReplay";

const TABS = ["Leaderboard", "Model Breakdown", "Problems", "Runs", "GEPA Experiments", "GEPA Replay", "AutoResearch"] as const;
type Tab = (typeof TABS)[number];

const TAB_SLUGS: Record<Tab, string> = {
  "Leaderboard": "leaderboard",
  "Model Breakdown": "models",
  "Problems": "problems",
  "Runs": "runs",
  "GEPA Experiments": "gepa",
  "GEPA Replay": "replay",
  "AutoResearch": "autoresearch",
};
const SLUG_TO_TAB = Object.fromEntries(
  Object.entries(TAB_SLUGS).map(([tab, slug]) => [slug, tab as Tab])
);

// Global fetch activity tracker
let activeFetches = 0;
let listeners: (() => void)[] = [];
function notifyListeners() { listeners.forEach((l) => l()); }

const originalFetch = typeof window !== "undefined" ? window.fetch : undefined;
if (typeof window !== "undefined") {
  window.fetch = async (...args) => {
    // Only track /api calls
    const url = typeof args[0] === "string" ? args[0] : (args[0] as Request)?.url || "";
    const isApi = url.startsWith("/api");
    if (isApi) { activeFetches++; notifyListeners(); }
    try {
      return await originalFetch!(...args);
    } finally {
      if (isApi) { activeFetches--; notifyListeners(); }
    }
  };
}

function useIsLoading() {
  return useSyncExternalStore(
    (cb) => { listeners.push(cb); return () => { listeners = listeners.filter((l) => l !== cb); }; },
    () => activeFetches > 0,
    () => false,
  );
}

function parseHash(): { tab: Tab; runId?: string } {
  if (typeof window === "undefined") return { tab: "Leaderboard" };
  const hash = window.location.hash.replace("#", "");
  const [slug, ...rest] = hash.split("/");
  const tab = SLUG_TO_TAB[slug] || "Leaderboard";
  const runId = rest.length > 0 ? rest.join("/") : undefined;
  return { tab, runId };
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("Leaderboard");
  const [gepaRunId, setGepaRunId] = useState<string | undefined>();
  const [tabKey, setTabKey] = useState(0);
  const isLoading = useIsLoading();

  // Read hash on mount and on hash change
  useEffect(() => {
    function onHashChange() {
      const { tab, runId } = parseHash();
      setActiveTab(tab);
      setGepaRunId(runId);
      setTabKey((k) => k + 1);
    }
    onHashChange();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((tab: Tab, runId?: string) => {
    const slug = TAB_SLUGS[tab];
    window.location.hash = runId ? `${slug}/${runId}` : slug;
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-[#1e1e24] px-3 sm:px-6 py-4" style={{ background: "linear-gradient(180deg, #111114 0%, #0c0c0f 100%)" }}>
        <div className="max-w-[1400px] mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-zinc-100">
                Equational Theories Dashboard
              </h1>
              <p className="text-[11px] text-zinc-600 mt-0.5 tracking-wide">
                SAIR Mathematics Distillation Challenge — Stage 1
              </p>
            </div>
            <div className={`flex items-center gap-1.5 ml-3 px-2.5 py-1 rounded-md bg-[#0c0c0f] border border-[#1e1e24] transition-opacity ${isLoading ? "opacity-100" : "opacity-0"}`}>
              <div className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse shadow-[0_0_6px_rgba(56,189,248,0.4)]" />
              <span className="text-[10px] text-zinc-600 uppercase tracking-wider">loading</span>
            </div>
          </div>
          <div className="flex items-center gap-0.5 bg-[#0c0c0f] rounded-lg p-1 border border-[#1e1e24] overflow-x-auto scrollbar-hide w-full sm:w-auto">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => navigate(tab)}
                className={`px-3 py-1.5 text-[10px] sm:text-[11px] rounded-md transition-all whitespace-nowrap ${
                  activeTab === tab
                    ? "text-sky-300 font-semibold"
                    : "text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.02]"
                }`}
                style={activeTab === tab ? {
                  background: "linear-gradient(135deg, rgba(14,165,233,0.15), rgba(56,189,248,0.08))",
                  boxShadow: "0 0 10px rgba(56,189,248,0.08), inset 0 0 0 1px rgba(56,189,248,0.15)",
                } : undefined}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 px-3 sm:px-6 py-4 sm:py-6">
        <div className="max-w-[1400px] mx-auto">
          {activeTab === "Leaderboard" && <LeaderboardView key={tabKey} />}
          {activeTab === "Model Breakdown" && <ModelBreakdownView key={tabKey} />}
          {activeTab === "Problems" && <ProblemExplorer key={tabKey} />}
          {activeTab === "Runs" && <RunsExplorer key={tabKey} />}
          {activeTab === "GEPA Experiments" && (
            <GepaExperiments
              key={tabKey}
              initialRunId={gepaRunId}
              onNavigate={(runId) => navigate("GEPA Experiments", runId)}
            />
          )}
          {activeTab === "GEPA Replay" && <GepaReplay key={tabKey} />}
          {activeTab === "AutoResearch" && <AutoResearchView key={tabKey} />}
        </div>
      </main>
    </div>
  );
}
