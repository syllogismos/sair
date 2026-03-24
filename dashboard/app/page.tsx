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
      <header className="border-b border-[#27272a] px-6 py-4">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                Equational Theories Dashboard
              </h1>
              <p className="text-sm text-[#a1a1aa] mt-0.5">
                SAIR Mathematics Distillation Challenge — Stage 1
              </p>
            </div>
            {isLoading && (
              <div className="flex items-center gap-1.5 ml-3 px-2 py-1 rounded bg-[#18181b] border border-[#27272a]">
                <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                <span className="text-xs text-zinc-500">loading</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 bg-[#18181b] rounded-lg p-1 border border-[#27272a]">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => navigate(tab)}
                className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                  activeTab === tab
                    ? "bg-[#6366f1] text-white font-medium"
                    : "text-[#a1a1aa] hover:text-white hover:bg-[#27272a]"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 px-6 py-6">
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
