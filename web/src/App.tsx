import { useState } from "react";
import { useOverallStats } from "./hooks/useOverallStats";
import { ProviderBarChart } from "./components/ProviderBarChart";
import { SummaryCards } from "./components/SummaryCards";
import { MetricSelector } from "./components/MetricSelector";
import { ErrorState } from "./components/ErrorState";
import { Skeleton } from "./components/Skeleton";

export type MetricKey =
  | "dealSuccessRate"
  | "retrievalSuccessRate"
  | "ingestLatency"
  | "chainLatency"
  | "dealLatency"
  | "retrievalLatency"
  | "retrievalThroughput"
  | "totalDeals"
  | "totalRetrievals";

export default function App() {
  const { data, loading, error, refetch } = useOverallStats();
  const [metric, setMetric] = useState<MetricKey>("dealSuccessRate");

  if (loading) return <Skeleton />;
  if (error)
    return (
      <div className="p-6">
        <ErrorState message={error} onRetry={refetch} />
      </div>
    );
  if (!data) return null;

  const providers = data.overallStats.providerPerformance;

  return (
    <div className="min-h-screen cyber-bg" data-theme="cyberpunk">
      {/* Animated background particles */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-yellow-400 rounded-full animate-pulse opacity-60"></div>
        <div className="absolute top-3/4 right-1/4 w-1 h-1 bg-yellow-300 rounded-full animate-ping opacity-40"></div>
        <div className="absolute top-1/2 left-3/4 w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse opacity-50"></div>
        <div className="absolute top-1/3 right-1/3 w-1 h-1 bg-yellow-400 rounded-full animate-ping opacity-30"></div>
      </div>

      <header className="cyber-header sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-12 h-12 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-xl flex items-center justify-center animate-glow">
                  <span className="text-black font-black text-lg">DB</span>
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-400 rounded-full animate-ping"></div>
              </div>
              <div>
                <h1 className="text-3xl font-black cyber-text-glow text-yellow-400">MINI DEAL BOT</h1>
                <p className="text-yellow-300/60 text-sm font-medium">FILECOIN STORAGE PROVIDER METRICS</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 p-8 space-y-12 max-w-7xl mx-auto">
        <div className="text-center py-12 relative">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-yellow-400/5 to-transparent"></div>
          <h2 className="text-6xl font-black cyber-text-glow text-yellow-400 mb-4 relative z-10">PROVIDER ANALYTICS</h2>
          <p className="text-yellow-300/80 text-xl font-medium relative z-10">
            Automated deal creation & storage performance monitoring
          </p>
          <div className="mt-6 flex justify-center">
            <div className="w-32 h-1 bg-gradient-to-r from-transparent via-yellow-400 to-transparent"></div>
          </div>
        </div>

        <SummaryCards stats={data.overallStats} />

        <section className="glass-card-cyber relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-yellow-400/0 via-yellow-400/60 to-yellow-400/0"></div>
          <div className="p-8">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 mb-8">
              <div className="relative">
                <h3 className="text-3xl font-bold cyber-text-glow text-yellow-400 mb-2">
                  STORAGE PROVIDER PERFORMANCE
                </h3>
                <p className="text-yellow-300/70 text-lg">
                  Deal success rates, latency metrics & retrieval performance
                </p>
                <div className="absolute -left-4 top-0 w-1 h-full bg-gradient-to-b from-yellow-400/60 to-transparent"></div>
              </div>
              <MetricSelector value={metric} onChange={setMetric} />
            </div>
            <div className="chart-container-cyber">
              <ProviderBarChart data={providers} metric={metric} />
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 mt-20 py-8 border-t border-yellow-400/20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
            <div className="glass-morphism rounded-2xl p-6">
              <p className="text-yellow-400 font-bold text-lg cyber-text-glow mb-2">MINI DEAL BOT ANALYTICS</p>
              <p className="text-yellow-300/60">Automated storage deals on Filecoin Calibration Network</p>
              <p className="text-yellow-300/40 text-sm mt-1">
                Creates deals every 30 minutes • CDN A/B testing • Performance tracking
              </p>
            </div>

            <div className="glass-morphism rounded-2xl p-6">
              <div className="flex items-center gap-3">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6 text-yellow-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                  />
                </svg>
                <div>
                  <p className="text-yellow-400 font-semibold">Open Source</p>
                  <a
                    href="https://github.com/FilOzone/dealbot"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-yellow-300/80 hover:text-yellow-400 transition-colors text-sm cyber-text-glow"
                  >
                    github.com/FilOzone/dealbot
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
