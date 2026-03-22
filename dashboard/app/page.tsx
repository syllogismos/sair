"use client";

import { useEffect, useState } from "react";
import LeaderboardView from "./components/LeaderboardView";
import ModelBreakdownView from "./components/ModelBreakdownView";
import ProblemExplorer from "./components/ProblemExplorer";
import RunsExplorer from "./components/RunsExplorer";
import GepaExperiments from "./components/GepaExperiments";
import AutoResearchView from "./components/AutoResearchView";

const TABS = ["Leaderboard", "Model Breakdown", "Problems", "Runs", "GEPA Experiments", "AutoResearch"] as const;
type Tab = (typeof TABS)[number];

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("Leaderboard");

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
                onClick={() => setActiveTab(tab)}
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
          {activeTab === "Leaderboard" && <LeaderboardView />}
          {activeTab === "Model Breakdown" && <ModelBreakdownView />}
          {activeTab === "Problems" && <ProblemExplorer />}
          {activeTab === "Runs" && <RunsExplorer />}
          {activeTab === "GEPA Experiments" && <GepaExperiments />}
          {activeTab === "AutoResearch" && <AutoResearchView />}
        </div>
      </main>
    </div>
  );
}
