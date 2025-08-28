import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Legend, CartesianGrid } from "recharts";
import type { DailyMetricDto } from "../types/stats";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";

type ChartData = {
  date: string;
  withCDN: number;
  withoutCDN: number;
};

type ThroughputChartData = {
  date: string;
  ingestWithCDN: number;
  ingestWithoutCDN: number;
  retrievalWithCDN: number;
  retrievalWithoutCDN: number;
};

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function transformData(
  dailyMetrics: DailyMetricDto[],
  cdnKey: keyof DailyMetricDto,
  noCdnKey: keyof DailyMetricDto,
): ChartData[] {
  return dailyMetrics.map((metric) => ({
    date: formatDate(metric.date),
    withCDN: metric[cdnKey] as number,
    withoutCDN: metric[noCdnKey] as number,
  }));
}

function transformThroughputData(dailyMetrics: DailyMetricDto[]): ThroughputChartData[] {
  return dailyMetrics.map((metric) => ({
    date: formatDate(metric.date),
    ingestWithCDN: metric.avgIngestThroughputWithCDN || 0,
    ingestWithoutCDN: metric.avgIngestThroughputWithoutCDN || 0,
    retrievalWithCDN: metric.avgRetrievalThroughputWithCDN || 0,
    retrievalWithoutCDN: metric.avgRetrievalThroughputWithoutCDN || 0,
  }));
}

interface DailyChartProps {
  data: DailyMetricDto[];
  title: string;
  cdnKey: keyof DailyMetricDto;
  noCdnKey: keyof DailyMetricDto;
  yTickFormatter?: (v: number) => string;
}

function DailyChart({ data, title, cdnKey, noCdnKey, yTickFormatter }: DailyChartProps) {
  const chartData = transformData(data, cdnKey, noCdnKey);

  const chartConfig = {
    withCDN: { label: "With CDN", color: "var(--chart-1)" },
    withoutCDN: { label: "Without CDN", color: "var(--chart-5)" },
  };

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-3">{title}</p>
      <div className="w-full h-[420px]">
        <ChartContainer config={chartConfig} className="min-h-[200px] max-h-[420px]  w-full">
          <BarChart data={chartData} margin={{ left: 30, top: 20 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis tickFormatter={yTickFormatter} fontSize={12} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Legend />
            <Bar dataKey="withCDN" fill="var(--chart-1)" name="With CDN" radius={6} maxBarSize={100} />
            <Bar dataKey="withoutCDN" fill="var(--chart-5)" name="Without CDN" radius={6} maxBarSize={100} />
          </BarChart>
        </ChartContainer>
      </div>
    </div>
  );
}

function ThroughputLineChart({
  data,
  yTickFormatter,
}: {
  data: DailyMetricDto[];
  yTickFormatter?: (v: number) => string;
}) {
  const chartData = transformThroughputData(data);

  const chartConfig = {
    ingestWithCDN: { label: "Ingest (CDN)", color: "var(--chart-1)" },
    ingestWithoutCDN: { label: "Ingest (Direct)", color: "var(--chart-3)" },
    retrievalWithCDN: { label: "Retrieval (CDN)", color: "var(--chart-2)" },
    retrievalWithoutCDN: { label: "Retrieval (Direct)", color: "var(--chart-5)" },
  };

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-3">Throughput trends (daily)</p>
      <div className="w-full h-[420px]">
        <ChartContainer config={chartConfig} className="min-h-[200px] max-h-[420px]  w-full">
          <LineChart data={chartData} margin={{ left: 30, top: 20 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis tickFormatter={yTickFormatter} fontSize={12} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Legend />
            <Line
              type="monotone"
              dataKey="ingestWithCDN"
              stroke="var(--color-ingestWithCDN)"
              name="Ingest (CDN)"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="ingestWithoutCDN"
              stroke="var(--color-ingestWithoutCDN)"
              name="Ingest (Direct)"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="retrievalWithCDN"
              stroke="var(--color-retrievalWithCDN)"
              name="Retrieval (CDN)"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="retrievalWithoutCDN"
              stroke="var(--color-retrievalWithoutCDN)"
              name="Retrieval (Direct)"
              strokeWidth={2}
            />
          </LineChart>
        </ChartContainer>
      </div>
    </div>
  );
}

export function DailyMetricsCharts({ dailyMetrics }: { dailyMetrics: DailyMetricDto[] }) {
  const fmtNum = (v: number) => v.toLocaleString();
  const fmtPct = (v: number) => `${v.toFixed(2)}%`;
  const fmtMs = (v: number) => `${Math.round(v)} ms`;

  return (
    <div className="space-y-12">
      <ThroughputLineChart data={dailyMetrics} yTickFormatter={fmtNum} />

      <DailyChart
        data={dailyMetrics}
        title="RETRIEVAL SUCCESS RATES (DAILY)"
        cdnKey="retrievalsSuccessRateWithCDN"
        noCdnKey="retrievalsSuccessRateWithoutCDN"
        yTickFormatter={fmtPct}
      />

      <DailyChart
        data={dailyMetrics}
        title="RETRIEVAL LATENCY (DAILY)"
        cdnKey="avgRetrievalLatencyWithCDN"
        noCdnKey="avgRetrievalLatencyWithoutCDN"
        yTickFormatter={fmtMs}
      />
    </div>
  );
}
