import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from "recharts";
import type { DailyMetricDto } from "../types/stats";

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

  return (
    <div>
      <h4 className="text-xl font-extrabold text-yellow-400 mb-4">{title}</h4>
      <div className="chart-container-cyber">
        <div className="w-full h-[420px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis tickFormatter={yTickFormatter} />
              <Tooltip
                formatter={(value: any, name) => [
                  yTickFormatter ? yTickFormatter(Number(value)) : value,
                  name as string,
                ]}
              />
              <Legend />
              <Bar dataKey="withCDN" fill="#22c55e" name="With CDN" />
              <Bar dataKey="withoutCDN" fill="#ef4444" name="Without CDN" />
            </BarChart>
          </ResponsiveContainer>
        </div>
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

  return (
    <div>
      <h4 className="text-xl font-extrabold text-yellow-400 mb-4">THROUGHPUT TRENDS (DAILY)</h4>
      <div className="chart-container-cyber">
        <div className="w-full h-[420px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis tickFormatter={yTickFormatter} />
              <Tooltip
                formatter={(value: any, name) => [
                  yTickFormatter ? yTickFormatter(Number(value)) : value,
                  name as string,
                ]}
              />
              <Legend />
              <Line type="monotone" dataKey="ingestWithCDN" stroke="#22c55e" strokeWidth={3} name="Ingest (CDN)" />
              <Line
                type="monotone"
                dataKey="ingestWithoutCDN"
                stroke="#ef4444"
                strokeWidth={3}
                name="Ingest (Direct)"
              />
              <Line
                type="monotone"
                dataKey="retrievalWithCDN"
                stroke="#3b82f6"
                strokeWidth={3}
                name="Retrieval (CDN)"
              />
              <Line
                type="monotone"
                dataKey="retrievalWithoutCDN"
                stroke="#f59e0b"
                strokeWidth={3}
                name="Retrieval (Direct)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
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
