import type { OverallStatsDto } from "../types/stats";

const formatPct = (v: number) => `${v.toFixed(2)}%`;
const formatNum = (v: number) => v.toLocaleString();

function Stat({ label, value, delay = 0 }: { label: string; value: string; delay?: number }) {
  return (
    <div className="stat-cyber" style={{ "--delay": `${delay}s` } as React.CSSProperties}>
      <div className="stat-title-cyber">{label}</div>
      <div className="stat-value-cyber">{value}</div>
    </div>
  );
}

export function SummaryCards({ stats }: { stats: OverallStatsDto }) {
  const metrics = [
    { label: "TOTAL DEALS", value: formatNum(stats.totalDeals) },
    { label: "TOTAL RETRIEVALS", value: formatNum(stats.totalRetrievals) },
    { label: "CDN DEAL SUCCESS", value: formatPct(stats.cdnDealsSuccessRate) },
    { label: "DIRECT DEAL SUCCESS", value: formatPct(stats.directDealsSuccessRate) },
    { label: "CDN RETRIEVAL SUCCESS", value: formatPct(stats.cdnRetrievalsSuccessRate) },
    { label: "DIRECT RETRIEVAL SUCCESS", value: formatPct(stats.directRetrievalsSuccessRate) },
    { label: "AVG Injest LATENCY", value: `${formatNum(stats.ingestLatency)} ms` },
    { label: "AVG RETRV THROUGHPUT", value: formatNum(stats.retrievalThroughput) },
  ];

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {metrics.map((metric, index) => (
        <div
          key={metric.label}
          className="metric-card-cyber relative overflow-hidden"
          style={{ "--delay": `${index * 0.1}s` } as React.CSSProperties}
        >
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-yellow-400/0 via-yellow-400/80 to-yellow-400/0"></div>
          <div className="absolute bottom-0 right-0 w-0.5 h-full bg-gradient-to-t from-yellow-400/0 via-yellow-400/60 to-yellow-400/0"></div>
          <Stat label={metric.label} value={metric.value} delay={index * 0.1} />
          <div className="absolute top-2 right-2 w-2 h-2 bg-yellow-400/60 rounded-full animate-pulse"></div>
        </div>
      ))}
    </section>
  );
}
