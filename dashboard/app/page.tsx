"use client";

import { useEffect, useState, useCallback } from "react";
import LeaderboardView from "./components/LeaderboardView";
import ModelBreakdownView from "./components/ModelBreakdownView";
import ProblemExplorer from "./components/ProblemExplorer";
import RunsExplorer from "./components/RunsExplorer";
import GepaExperiments from "./components/GepaExperiments";
import AutoResearchView from "./components/AutoResearchView";

const TABS = ["Leaderboard", "Model Breakdown", "Problems", "Runs", "GEPA Experiments", "AutoResearch"] as const;
type Tab = (typeof TABS)[number];

const TAB_SLUGS: Record<Tab, string> = {
  "Leaderboard": "leaderboard",
  "Model Breakdown": "models",
  "Problems": "problems",
  "Runs": "runs",
  "GEPA Experiments": "gepa",
  "AutoResearch": "autoresearch",
};
const SLUG_TO_TAB = Object.fromEntries(
  Object.entries(TAB_SLUGS).map(([tab, slug]) => [slug, tab as Tab])
);

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
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Equational Theories Dashboard
            </h1>
            <p className="text-sm text-[#a1a1aa] mt-0.5">
              SAIR Mathematics Distillation Challenge — Stage 1
            </p>
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
          {activeTab === "AutoResearch" && <AutoResearchView key={tabKey} />}
        </div>
      </main>
    </div>
  );
}
