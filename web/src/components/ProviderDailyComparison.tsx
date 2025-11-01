import { CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from "recharts";
import type { ProviderDailyMetrics } from "../types/metrics";
import { formatDuration, formatPercentage } from "../utils/formatters";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";

/**
 * Provider daily comparison charts
 * Displays provider-specific metrics over time for comparison
 */

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function truncateAddress(address: string, maxLength: number = 12): string {
  if (address.length <= maxLength) return address;
  return `${address.slice(0, maxLength - 3)}...`;
}

type ChartDataPoint = {
  date: string;
  [key: string]: string | number;
};

/**
 * Transform provider daily metrics to chart format
 */
function transformToChartData(
  metrics: ProviderDailyMetrics[],
  metricKey: keyof Omit<ProviderDailyMetrics, "date" | "spAddress">,
): ChartDataPoint[] {
  return metrics.map((metric) => ({
    date: formatDate(metric.date),
    value: metric[metricKey] as number,
  }));
}

// Chart colors
const CHART_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#22c55e", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#f97316", // orange
  "#84cc16", // lime
  "#ec4899", // pink
  "#6366f1", // indigo
];

/**
 * Single provider trend chart
 */
interface ProviderTrendChartProps {
  metrics: ProviderDailyMetrics[];
  title: string;
  metricKey: keyof Omit<ProviderDailyMetrics, "date" | "spAddress">;
  yTickFormatter?: (v: number) => string;
  valueFormatter: (v: number) => string;
  color?: string;
}

function ProviderTrendChart({
  metrics,
  title,
  metricKey,
  yTickFormatter,
  valueFormatter,
  color = CHART_COLORS[0],
}: ProviderTrendChartProps) {
  const chartData = transformToChartData(metrics, metricKey);
  const providerAddress = metrics[0]?.spAddress || "Provider";
  const displayName = truncateAddress(providerAddress);

  const chartConfig: ChartConfig = {
    value: { label: displayName, color },
  };

  return (
    <div>
      <p className='text-sm text-muted-foreground mb-3'>{title}</p>
      <div className='w-full h-[420px]'>
        <ChartContainer config={chartConfig} className='min-h-[200px] max-h-[420px] h-full w-full'>
          <LineChart data={chartData} margin={{ left: 30, top: 10 }}>
            <CartesianGrid strokeDasharray='3 3' />
            <XAxis dataKey='date' />
            <YAxis tickFormatter={yTickFormatter} fontSize={12} />
            <ChartTooltip content={<ChartTooltipContent valueFormatter={(v) => valueFormatter(v as number)} />} />
            <Legend wrapperStyle={{ fontSize: "12px" }} />
            <Line type='monotone' dataKey='value' stroke={color} strokeWidth={2} name={displayName} />
          </LineChart>
        </ChartContainer>
      </div>
    </div>
  );
}

/**
 * Provider daily comparison component
 * Shows metrics trends for a specific provider over time
 *
 * Note: This component displays single-provider trends.
 * For multi-provider comparison, use the useProviderMetrics hook
 * with multiple providers and combine the data.
 */
export function ProviderDailyComparison({ metrics }: { metrics: ProviderDailyMetrics[] }) {
  if (!metrics || metrics.length === 0) {
    return (
      <div className='text-center text-muted-foreground py-8'>
        <p>No daily metrics available for this provider.</p>
      </div>
    );
  }

  return (
    <div className='space-y-12'>
      {/* Success Rates */}
      <ProviderTrendChart
        metrics={metrics}
        title='DEAL SUCCESS RATE TREND'
        metricKey='dealSuccessRate'
        yTickFormatter={(v) => formatPercentage(v)}
        valueFormatter={(v) => formatPercentage(v)}
        color={CHART_COLORS[0]}
      />

      <ProviderTrendChart
        metrics={metrics}
        title='RETRIEVAL SUCCESS RATE TREND'
        metricKey='retrievalSuccessRate'
        yTickFormatter={(v) => formatPercentage(v)}
        valueFormatter={(v) => formatPercentage(v)}
        color={CHART_COLORS[1]}
      />

      {/* Latencies */}
      <ProviderTrendChart
        metrics={metrics}
        title='DEAL LATENCY TREND'
        metricKey='avgDealLatencyMs'
        yTickFormatter={(v) => formatDuration(v)}
        valueFormatter={(v) => formatDuration(v)}
        color={CHART_COLORS[2]}
      />

      <ProviderTrendChart
        metrics={metrics}
        title='RETRIEVAL LATENCY TREND'
        metricKey='avgRetrievalLatencyMs'
        yTickFormatter={(v) => formatDuration(v)}
        valueFormatter={(v) => formatDuration(v)}
        color={CHART_COLORS[3]}
      />
    </div>
  );
}
