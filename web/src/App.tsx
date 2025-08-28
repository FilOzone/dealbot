import { useOverallStats } from "./hooks/useOverallStats";
import { useDailyStats } from "./hooks/useDailyStats";
import { ProviderBarChart } from "./components/ProviderBarChart";
import { SummaryCards } from "./components/SummaryCards";
import { DailyMetricsCharts } from "./components/DailyMetricsCharts";
import { ProviderDailyComparison } from "./components/ProviderDailyComparison";
import { ErrorState } from "./components/ErrorState";
import { Skeleton } from "./components/Skeleton";

export type MetricKey =
  | "dealSuccessRate"
  | "retrievalSuccessRate"
  | "ingestLatency"
  | "chainLatency"
  | "dealLatency"
  | "retrievalLatency"
  | "ingestThroughput"
  | "retrievalThroughput"
  | "totalDeals"
  | "totalRetrievals";

export default function App() {
  const { data, loading, error, refetch } = useOverallStats();
  const { data: dailyData, loading: dailyLoading, error: dailyError } = useDailyStats();

  if (loading || dailyLoading) return <Skeleton />;
  if (error)
    return (
      <div className="p-6">
        <ErrorState message={error} onRetry={refetch} />
      </div>
    );
  if (!data) return null;

  const providers = data.overallStats.providerPerformance;

  // formatters for Y-axis and tooltip
  const fmtNum = (v: number) => v.toLocaleString();
  const fmtMs = (v: number) => `${Math.round(v)} ms`;
  const fmtPct = (v: number) => `${v.toFixed(2)}%`;

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
        <div className="text-center py-8 relative">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-yellow-400/5 to-transparent"></div>
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
          <div className="p-8 space-y-12">
            <div className="relative">
              <h3 className="text-3xl font-bold cyber-text-glow text-yellow-400 mb-2">STORAGE PROVIDER PERFORMANCE</h3>
              <p className="text-yellow-300/70 text-lg">Counts, latency, success rates, and throughput comparisons</p>
              <div className="absolute -left-4 top-0 w-1 h-full bg-gradient-to-b from-yellow-400/60 to-transparent"></div>
            </div>

            {/* Counts */}
            <div>
              <h4 className="text-xl font-extrabold text-yellow-400 mb-4">TOTAL COUNTS</h4>
              <div className="chart-container-cyber">
                <ProviderBarChart
                  data={providers}
                  series={[
                    { key: "totalDeals", color: "#3b82f6", label: "Total Deals" },
                    { key: "totalRetrievals", color: "#10b981", label: "Total Retrievals" },
                  ]}
                  yTickFormatter={fmtNum}
                />
              </div>
            </div>

            {/* Latencies */}
            <div>
              <h4 className="text-xl font-extrabold text-yellow-400 mb-4">LATENCY (ms)</h4>
              <div className="chart-container-cyber">
                <ProviderBarChart
                  data={providers}
                  series={[
                    { key: "ingestLatency", color: "#f59e0b", label: "Ingest" },
                    { key: "chainLatency", color: "#f97316", label: "Chain" },
                    { key: "dealLatency", color: "#ef4444", label: "Deal" },
                    { key: "retrievalLatency", color: "#8b5cf6", label: "Retrieval" },
                  ]}
                  yTickFormatter={fmtMs}
                />
              </div>
            </div>

            {/* Success Rates */}
            <div>
              <h4 className="text-xl font-extrabold text-yellow-400 mb-4">SUCCESS RATES</h4>
              <div className="chart-container-cyber">
                <ProviderBarChart
                  data={providers}
                  series={[
                    { key: "dealSuccessRate", color: "#22c55e", label: "Deal Success %" },
                    { key: "retrievalSuccessRate", color: "#06b6d4", label: "Retrieval Success %" },
                  ]}
                  yTickFormatter={fmtPct}
                />
              </div>
            </div>

            {/* Throughput */}
            <div>
              <h4 className="text-xl font-extrabold text-yellow-400 mb-4">THROUGHPUT</h4>
              <div className="chart-container-cyber">
                <ProviderBarChart
                  data={providers}
                  series={[
                    { key: "ingestThroughput", color: "#a855f7", label: "Ingest Throughput" },
                    { key: "retrievalThroughput", color: "#14b8a6", label: "Retrieval Throughput" },
                  ]}
                  yTickFormatter={fmtNum}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Daily Metrics Section */}
        {dailyData && dailyData.dailyMetrics.length > 0 && (
          <section className="glass-card-cyber relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-yellow-400/0 via-yellow-400/60 to-yellow-400/0"></div>
            <div className="p-8 space-y-12">
              <div className="relative">
                <h3 className="text-3xl font-bold cyber-text-glow text-yellow-400 mb-2">DAILY METRICS TRENDS</h3>
                <p className="text-yellow-300/70 text-lg">CDN vs Direct performance over time ({dailyData.summary.totalDays} days)</p>
                <div className="absolute -left-4 top-0 w-1 h-full bg-gradient-to-b from-yellow-400/60 to-transparent"></div>
              </div>
              
              <DailyMetricsCharts dailyMetrics={dailyData.dailyMetrics} />
            </div>
          </section>
        )}

        {/* Provider Daily Comparison Section */}
        {dailyData && dailyData.dailyMetrics.length > 0 && (
          <section className="glass-card-cyber relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-yellow-400/0 via-yellow-400/60 to-yellow-400/0"></div>
            <div className="p-8 space-y-12">
              <div className="relative">
                <h3 className="text-3xl font-bold cyber-text-glow text-yellow-400 mb-2">PROVIDER PERFORMANCE TRENDS</h3>
                <p className="text-yellow-300/70 text-lg">Daily performance trends by provider over {dailyData.summary.totalDays} days</p>
                <div className="absolute -left-4 top-0 w-1 h-full bg-gradient-to-b from-yellow-400/60 to-transparent"></div>
              </div>
              
              <ProviderDailyComparison dailyMetrics={dailyData.dailyMetrics} />
            </div>
          </section>
        )}

        {/* Daily Error State */}
        {dailyError && (
          <section className="glass-card-cyber relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-400/0 via-red-400/60 to-red-400/0"></div>
            <div className="p-8">
              <div className="relative">
                <h3 className="text-3xl font-bold cyber-text-glow text-red-400 mb-2">DAILY METRICS UNAVAILABLE</h3>
                <p className="text-red-300/70 text-lg">Unable to load daily metrics data</p>
                <div className="absolute -left-4 top-0 w-1 h-full bg-gradient-to-b from-red-400/60 to-transparent"></div>
              </div>
              <div className="mt-6">
                <ErrorState message={dailyError} onRetry={() => window.location.reload()} />
              </div>
            </div>
          </section>
        )}
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
