import { LineChart, Line, XAxis, YAxis, Legend, CartesianGrid } from "recharts";
import type { ProviderDailyMetricDto, DailyMetricDto } from "../types/stats";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "./ui/chart";

function short(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
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
  metricKey: keyof ProviderDailyMetricDto,
): ProviderTrendData[] {
  // Get all unique providers
  const providers = new Set<string>();
  dailyMetrics.forEach((day) => {
    day.providers.forEach((p) => providers.add(p.provider));
  });

  // Transform data to have date and each provider as columns
  return dailyMetrics.map((day) => {
    const row: ProviderTrendData = { date: formatDate(day.date) };

    providers.forEach((provider) => {
      const providerData = day.providers.find((p) => p.provider === provider);
      const shortProvider = short(provider);
      row[shortProvider] = providerData ? (providerData[metricKey] as number) || 0 : 0;
    });

    return row;
  });
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
}: {
  dailyMetrics: DailyMetricDto[];
  title: string;
  metricKey: keyof ProviderDailyMetricDto;
  yTickFormatter?: (v: number) => string;
}) {
  const chartData = transformProviderTrends(dailyMetrics, metricKey);

  // Get unique providers for lines
  const providers = new Set<string>();
  dailyMetrics.forEach((day) => {
    day.providers.forEach((p) => providers.add(short(p.provider)));
  });
  const providerList = Array.from(providers);
  const colors = getProviderColors(providerList);

  const chartConfig = providerList.reduce((acc, provider) => {
    acc[provider] = { label: provider, color: colors[providerList.indexOf(provider)] };
    return acc;
  }, {} as ChartConfig);

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-3">{title}</p>
      <div className="w-full h-[420px]">
        <ChartContainer config={chartConfig} className="min-h-[200px] max-h-[420px]  w-full">
          <LineChart data={chartData} margin={{ left: 30, top: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis tickFormatter={yTickFormatter} fontSize={12} />
            <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
            <Legend />
            {providerList.map((provider, index) => (
              <Line
                key={provider}
                type="monotone"
                dataKey={provider}
                stroke={colors[index]}
                strokeWidth={2}
                name={provider}
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
  const fmtNum = (v: number) => v.toLocaleString();
  const fmtPct = (v: number) => `${v.toFixed(2)}%`;

  return (
    <div className="space-y-12">
      <ProviderTrendChart
        dailyMetrics={dailyMetrics}
        title="PROVIDER SUCCESS RATE TRENDS"
        metricKey="dealsSuccessRateWithCDN"
        yTickFormatter={fmtPct}
      />

      <ProviderTrendChart
        dailyMetrics={dailyMetrics}
        title="PROVIDER RETRIEVAL THROUGHPUT TRENDS"
        metricKey="avgRetrievalThroughputWithoutCDN"
        yTickFormatter={fmtNum}
      />
    </div>
  );
}
