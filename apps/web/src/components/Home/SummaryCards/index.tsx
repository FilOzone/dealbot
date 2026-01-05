import { useMemo } from "react";
import { ErrorState } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNetworkStats } from "@/hooks/useNetworkStats";
import { formatThroughput } from "@/utils/formatter";
import { formatDuration, formatNumber, formatPercentage } from "@/utils/formatters";
import SummaryCardsSkeleton from "./SummaryCardsSkeleton";

interface MetricCardProps {
  label: string;
  value: string;
  description?: string;
}

function MetricCard({ label, value, description }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-2 text-2xl font-semibold">{value}</div>
        {description && <div className="mt-1 text-xs text-muted-foreground">{description}</div>}
      </CardContent>
    </Card>
  );
}

/**
 * Summary cards component displaying network-wide statistics
 * Shows key metrics in a responsive grid layout
 */
function SummaryCards() {
  const { data, loading, error, refetch } = useNetworkStats();

  const metrics = useMemo(() => {
    if (!data) return [];

    return [
      {
        label: "TOTAL PROVIDERS",
        value: formatNumber(data.totalProviders),
        description: `${formatNumber(data.activeProviders)} active`,
      },
      {
        label: "TOTAL UPLOADS",
        value: formatNumber(data.totalDeals),
        description: `${formatPercentage(data.dealSuccessRate)} success rate`,
      },
      {
        label: "SUCCESSFUL UPLOADS",
        value: formatNumber(data.successfulDeals),
        description: `${formatNumber(data.totalDeals - data.successfulDeals)} failed`,
      },
      {
        label: "TOTAL RETRIEVALS",
        value: formatNumber(data.totalRetrievals),
        description: `${formatPercentage(data.retrievalSuccessRate)} success rate`,
      },
      {
        label: "SUCCESSFUL RETRIEVALS",
        value: formatNumber(data.successfulRetrievals),
        description: `${formatNumber(data.totalRetrievals - data.successfulRetrievals)} failed`,
      },
      {
        label: "AVG DEAL LATENCY",
        value: formatDuration(data.avgDealLatencyMs),
        description: "Deal creation time",
      },
      {
        label: "AVG INGEST LATENCY",
        value: formatDuration(data.avgIngestLatencyMs),
        description: "Piece upload completion time",
      },
      {
        label: "AVG RETRIEVAL LATENCY",
        value: formatDuration(data.avgRetrievalLatencyMs),
        description: "Retrieval completion time",
      },
      {
        label: "AVG RETRIEVAL TTFB",
        value: formatDuration(data.avgRetrievalTtfbMs),
        description: "Time to first byte",
      },
      {
        label: "AVG INGEST THROUGHPUT",
        value: formatThroughput(data.avgIngestThroughputBps),
        description: "Piece upload throughput",
      },
      {
        label: "AVG RETRIEVAL THROUGHPUT",
        value: formatThroughput(data.avgRetrievalThroughputBps),
        description: "Data retrieval throughput",
      },
    ];
  }, [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Network Statistics</CardTitle>
        <CardDescription>Overall performance metrics across all fwss approved storage providers</CardDescription>
      </CardHeader>
      <CardContent>
        {loading && <SummaryCardsSkeleton />}

        {error && <ErrorState message={error} onRetry={() => refetch()} />}

        {!loading && !error && data && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {metrics.map((metric) => (
              <MetricCard
                key={metric.label}
                label={metric.label}
                value={metric.value}
                description={metric.description}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default SummaryCards;
