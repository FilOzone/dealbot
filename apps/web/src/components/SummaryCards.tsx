import { formatThroughput } from "@/utils/formatter";
import type { NetworkOverallStats } from "../types/network";
import { formatDuration, formatNumber, formatPercentage } from "../utils/formatters";
import { Card, CardContent } from "./ui/card";

/**
 * Summary cards component displaying network-wide statistics
 * Shows key metrics in a responsive grid layout
 */
export function SummaryCards({ stats }: { stats: NetworkOverallStats | undefined }) {
  // Safety check: if stats is undefined, show loading state
  if (!stats) {
    return (
      <section className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4'>
        <Card>
          <CardContent className='p-4'>
            <div className='text-xs uppercase tracking-wide text-muted-foreground'>Loading...</div>
          </CardContent>
        </Card>
      </section>
    );
  }

  const metrics = [
    {
      label: "TOTAL PROVIDERS",
      value: formatNumber(stats.totalProviders),
      description: `${formatNumber(stats.activeProviders)} active`,
    },
    {
      label: "TOTAL UPLOADS",
      value: formatNumber(stats.totalDeals),
      description: `${formatPercentage(stats.dealSuccessRate)} success rate`,
    },
    {
      label: "SUCCESSFUL UPLOADS",
      value: formatNumber(stats.successfulDeals),
      description: `${formatNumber(stats.totalDeals - stats.successfulDeals)} failed`,
    },
    {
      label: "TOTAL RETRIEVALS",
      value: formatNumber(stats.totalRetrievals),
      description: `${formatPercentage(stats.retrievalSuccessRate)} success rate`,
    },
    {
      label: "SUCCESSFUL RETRIEVALS",
      value: formatNumber(stats.successfulRetrievals),
      description: `${formatNumber(stats.totalRetrievals - stats.successfulRetrievals)} failed`,
    },
    {
      label: "AVG DEAL LATENCY",
      value: formatDuration(stats.avgDealLatencyMs),
      description: "Deal creation time",
    },
    {
      label: "AVG INGEST LATENCY",
      value: formatDuration(stats.avgIngestLatencyMs),
      description: "Piece upload completion time",
    },
    {
      label: "AVG RETRIEVAL LATENCY",
      value: formatDuration(stats.avgRetrievalLatencyMs),
      description: "Retrieval completion time",
    },
    {
      label: "AVG RETRIEVAL TTFB",
      value: formatDuration(stats.avgRetrievalTtfbMs),
      description: "Time to first byte",
    },
    {
      label: "AVG INGEST THROUGHPUT",
      value: formatThroughput(stats.avgIngestThroughputBps),
      description: "Piece upload throughput",
    },
    {
      label: "AVG RETRIEVAL THROUGHPUT",
      value: formatThroughput(stats.avgRetrievalThroughputBps),
      description: "Data retrieval throughput",
    },
  ];

  return (
    <section className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4'>
      {metrics.map((metric) => (
        <Card key={metric.label}>
          <CardContent className='p-4'>
            <div className='text-xs uppercase tracking-wide text-muted-foreground'>{metric.label}</div>
            <div className='mt-2 text-2xl font-semibold'>{metric.value}</div>
            {metric.description && <div className='mt-1 text-xs text-muted-foreground'>{metric.description}</div>}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
