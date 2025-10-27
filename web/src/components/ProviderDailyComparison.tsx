import { CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from "recharts";
import { formatThroughput } from "@/utils/formatter";
import type { DailyMetricDto, ProviderDailyMetricDto } from "../types/stats";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";

function truncateName(name: string, maxLength: number = 20) {
  if (name.length <= maxLength) return name;
  return `${name.slice(0, maxLength - 1)}…`;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type ProviderTrendData = {
  date: string;
  [providerKey: string]: string | number;
};

function transformProviderTrends(
  dailyMetrics: DailyMetricDto[],
  metricKey: keyof ProviderDailyMetricDto | "overallDealsSuccessRate",
): { data: ProviderTrendData[]; providerNameMap: Map<string, string> } {
  const providerNameMap = new Map<string, string>();

  const data = dailyMetrics.map((day) => {
    const row: ProviderTrendData = { date: formatDate(day.date) };

    day.providers.forEach((p) => {
      if (!providerNameMap.has(p.provider)) {
        providerNameMap.set(p.provider, p.providerName);
      }

      const truncatedName = truncateName(p.providerName);

      if (metricKey === "overallDealsSuccessRate") {
        const cdnDeals = p.dealsWithCDN || 0;
        const directDeals = p.dealsWithoutCDN || 0;
        const totalDeals = cdnDeals + directDeals;

        if (totalDeals > 0) {
          const cdnSuccesses = (cdnDeals * (p.dealsSuccessRateWithCDN || 0)) / 100;
          const directSuccesses = (directDeals * (p.dealsSuccessRateWithoutCDN || 0)) / 100;
          row[truncatedName] = ((cdnSuccesses + directSuccesses) / totalDeals) * 100;
        } else {
          row[truncatedName] = 0;
        }
      } else {
        row[truncatedName] = (p[metricKey] as number) || 0;
      }
    });

    return row;
  });

  return { data, providerNameMap };
}

// Generate colors for providers
function getProviderColors(providers: string[]): string[] {
  const colors = [
    "#3b82f6",
    "#ef4444",
    "#22c55e",
    "#f59e0b",
    "#8b5cf6",
    "#06b6d4",
    "#f97316",
    "#84cc16",
    "#ec4899",
    "#6366f1",
  ];
  return providers.map((_, index) => colors[index % colors.length]);
}

function ProviderTrendChart({
  dailyMetrics,
  title,
  metricKey,
  yTickFormatter,
  type,
}: {
  dailyMetrics: DailyMetricDto[];
  title: string;
  metricKey: keyof ProviderDailyMetricDto | "overallDealsSuccessRate";
  yTickFormatter?: (v: number) => string;
  type: "percentage" | "throughput";
}) {
  const { data: chartData, providerNameMap } = transformProviderTrends(dailyMetrics, metricKey);

  const providerNames = Array.from(providerNameMap.values()).map((name) => truncateName(name));
  const colors = getProviderColors(providerNames);

  const chartConfig = providerNames.reduce((acc, name) => {
    acc[name] = { label: name, color: colors[providerNames.indexOf(name)] };
    return acc;
  }, {} as ChartConfig);

  return (
    <div>
      <p className='text-sm text-muted-foreground mb-3'>{title}</p>
      <div className='w-full h-[420px]'>
        <ChartContainer config={chartConfig} className='min-h-[200px] max-h-[420px] h-full w-full'>
          <LineChart data={chartData} margin={{ left: 30, top: 10 }}>
            <CartesianGrid strokeDasharray='3 3' />
            <XAxis dataKey='date' />
            <YAxis tickFormatter={yTickFormatter} fontSize={12} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  indicator='line'
                  valueFormatter={(v) => (type === "percentage" ? `${v}%` : formatThroughput(v as number))}
                />
              }
            />
            <Legend wrapperStyle={{ fontSize: "12px" }} />
            {providerNames.map((name, index) => (
              <Line
                key={name}
                type='monotone'
                dataKey={name}
                stroke={colors[index]}
                strokeWidth={2}
                name={name}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      </div>
    </div>
  );
}

export function ProviderDailyComparison({ dailyMetrics }: { dailyMetrics: DailyMetricDto[] }) {
  const fmtPct = (v: number) => `${v}%`;

  return (
    <div className='space-y-12'>
      <ProviderTrendChart
        dailyMetrics={dailyMetrics}
        title='PROVIDER OVERALL SUCCESS RATE TRENDS'
        metricKey='overallDealsSuccessRate'
        yTickFormatter={fmtPct}
        type='percentage'
      />

      <ProviderTrendChart
        dailyMetrics={dailyMetrics}
        title='PROVIDER RETRIEVAL THROUGHPUT TRENDS'
        metricKey='avgRetrievalThroughputWithoutCDN'
        yTickFormatter={formatThroughput}
        type='throughput'
      />
    </div>
  );
}
