import { formatMilliseconds, formatThroughput } from "@/utils/formatter";
import type { OverallStatsDto } from "../types/stats";
import { Card, CardContent } from "./ui/card";

const formatPct = (v: number) => `${v.toFixed(2)}%`;
const formatNum = (v: number) => v.toLocaleString();

export function SummaryCards({ stats }: { stats: OverallStatsDto }) {
  const metrics = [
    { label: "TOTAL DEALS", value: formatNum(stats.totalDeals) },
    { label: "TOTAL RETRIEVALS", value: formatNum(stats.totalRetrievals) },
    { label: "TOTAL DEALS ( CDN )", value: formatNum(stats.totalDealsWithCDN) },
    { label: "TOTAL DEALS ( WITHOUT CDN )", value: formatNum(stats.totalDealsWithoutCDN) },
    { label: "TOTAL RETRIEVALS ( CDN )", value: formatNum(stats.totalRetrievalsWithCDN) },
    { label: "TOTAL RETRIEVALS ( WITHOUT CDN )", value: formatNum(stats.totalRetrievalsWithoutCDN) },
    { label: "DEAL SUCCESS RATE ( CDN )", value: formatPct(stats.cdnDealsSuccessRate) },
    { label: "DEAL SUCCESS RATE ( WITHOUT CDN )", value: formatPct(stats.directDealsSuccessRate) },
    { label: "RETRIEVAL SUCCESS RATE ( WITHOUT CDN )", value: formatPct(stats.directRetrievalsSuccessRate) },
    { label: "AVG INGEST LATENCY", value: formatMilliseconds(stats.ingestLatency) },
    { label: "AVG INGEST THROUGHPUT", value: formatThroughput(stats.ingestThroughput) },
    { label: "AVG CHAIN LATENCY", value: formatMilliseconds(stats.chainLatency) },
    { label: "AVG RETRIEVAL THROUGHPUT", value: formatThroughput(stats.retrievalThroughput) },
  ];

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {metrics.map((m) => (
        <Card key={m.label}>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{m.label}</div>
            <div className="mt-2 text-2xl font-semibold">{m.value}</div>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
