import { CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from "recharts";
import { formatThroughput } from "@/utils/formatter";
import type { DailyAggregatedMetrics } from "../types/metrics";
import { formatDuration, formatPercentage } from "../utils/formatters";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";

/**
 * Daily metrics charts component
 * Displays time-series visualizations of network performance
 */

type ChartDataPoint = {
  date: string;
  [key: string]: string | number;
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Transform daily metrics to chart data format
 */
function transformToChartData(
  dailyMetrics: DailyAggregatedMetrics[],
  dataKeys: Array<{ key: keyof DailyAggregatedMetrics; label: string }>,
): ChartDataPoint[] {
  return dailyMetrics.map((metric) => {
    const point: ChartDataPoint = { date: formatDate(metric.date) };
    dataKeys.forEach(({ key, label }) => {
      point[label] = metric[key] as number;
    });
    return point;
  });
}

/**
 * Generic line chart component for daily metrics
 */
interface DailyLineChartProps {
  data: DailyAggregatedMetrics[];
  title: string;
  dataKeys: Array<{
    key: keyof DailyAggregatedMetrics;
    label: string;
    color: string;
  }>;
  yTickFormatter?: (v: number) => string;
  valueFormatter: (v: number) => string;
}

function DailyLineChart({ data, title, dataKeys, yTickFormatter, valueFormatter }: DailyLineChartProps) {
  const chartData = transformToChartData(
    data,
    dataKeys.map(({ key, label }) => ({ key, label })),
  );

  const chartConfig = dataKeys.reduce(
    (config, { label, color }) => ({
      ...config,
      [label]: { label, color },
    }),
    {},
  );

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-3">{title}</p>
      <div className="w-full h-[420px]">
        <ChartContainer config={chartConfig} className="min-h-[200px] h-full w-full">
          <LineChart data={chartData} margin={{ left: 30, top: 20 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis tickFormatter={yTickFormatter} fontSize={12} />
            <ChartTooltip content={<ChartTooltipContent valueFormatter={(v) => valueFormatter(v as number)} />} />
            <Legend />
            {dataKeys.map(({ label, color }) => (
              <Line key={label} type="monotone" dataKey={label} stroke={color} name={label} strokeWidth={2} />
            ))}
          </LineChart>
        </ChartContainer>
      </div>
    </div>
  );
}

/**
 * Main component displaying all daily metrics charts
 */
export function DailyMetricsCharts({ dailyMetrics }: { dailyMetrics: DailyAggregatedMetrics[] }) {
  return (
    <div className="space-y-12">
      {/* Success Rates */}
      <DailyLineChart
        data={dailyMetrics}
        title="SUCCESS RATES (DAILY)"
        dataKeys={[
          {
            key: "dealSuccessRate",
            label: "Upload Success Rate",
            color: "var(--chart-1)",
          },
          {
            key: "retrievalSuccessRate",
            label: "Retrieval Success Rate",
            color: "var(--chart-2)",
          },
        ]}
        yTickFormatter={(v) => formatPercentage(v)}
        valueFormatter={(v) => formatPercentage(v)}
      />

      {/* Latencies */}
      <DailyLineChart
        data={dailyMetrics}
        title="LATENCIES (DAILY)"
        dataKeys={[
          {
            key: "avgIngestLatencyMs",
            label: "Upload Ingest Latency",
            color: "var(--chart-1)",
          },
          {
            key: "avgRetrievalLatencyMs",
            label: "Retrieval Latency",
            color: "var(--chart-2)",
          },
          {
            key: "avgRetrievalTtfbMs",
            label: "Retrieval TTFB",
            color: "var(--chart-3)",
          },
        ]}
        yTickFormatter={(v) => formatDuration(v)}
        valueFormatter={(v) => formatDuration(v)}
      />

      {/* Unique Providers */}
      <DailyLineChart
        data={dailyMetrics}
        title="Throughputs (DAILY)"
        dataKeys={[
          {
            key: "avgRetrievalThroughputBps",
            label: "Retrieval Throughput",
            color: "var(--chart-1)",
          },
          {
            key: "avgIngestThroughputBps",
            label: "Ingest Throughput",
            color: "var(--chart-2)",
          },
        ]}
        yTickFormatter={(v) => formatThroughput(v)}
        valueFormatter={(v) => formatThroughput(v)}
      />
    </div>
  );
}
