import { Bar, BarChart, CartesianGrid, Legend, XAxis, YAxis } from "recharts";
import type { MetricKey, ProviderPerformanceDto } from "../types/stats";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";

function short(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

type Series = { key: MetricKey; color: string; label?: string };

function toChartData(list: ProviderPerformanceDto[], series: Series[]) {
  const sortKey = series[0]?.key;
  const sorted = sortKey ? [...list].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0)) : [...list];

  return sorted.map((p) => {
    const row: Record<string, string | number> = { name: short(p.provider) };
    for (const s of series) {
      // Coerce undefined to 0 for safe charting
      row[s.key] = (p[s.key] ?? 0) as number;
    }
    return row;
  });
}

export function ProviderBarChart({
  data,
  series,
  yTickFormatter,
}: {
  data: ProviderPerformanceDto[];
  series: Series[];
  yTickFormatter?: (v: number) => string;
}) {
  const chartData = toChartData(data, series);

  const chartConfig = series.reduce((acc, s) => {
    acc[s.key] = { label: s.label, color: s.color };
    return acc;
  }, {} as ChartConfig);

  return (
    <div className="w-full h-[420px]">
      <ChartContainer config={chartConfig} className="min-h-[200px] max-h-[420px] h-full w-full">
        <BarChart data={chartData} margin={{ left: 30, top: 20 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="name" />
          <YAxis tickFormatter={yTickFormatter} fontSize={12} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Legend />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              fill={`var(--color-${s.key})`}
              name={s.label ?? s.key}
              radius={4}
              maxBarSize={100}
            />
          ))}
        </BarChart>
      </ChartContainer>
    </div>
  );
}
