import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";
import type { ProviderPerformanceDto } from "../types/stats";
import type { MetricKey } from "../App";

function short(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

type Series = { key: MetricKey; color: string; label?: string };

function toChartData(list: ProviderPerformanceDto[], series: Series[]) {
  const sortKey = series[0]?.key;
  const sorted = sortKey
    ? [...list].sort(
        (a, b) => ((b as any)[sortKey] ?? 0) - ((a as any)[sortKey] ?? 0),
      )
    : [...list];

  return sorted.map((p) => {
    const row: Record<string, string | number> = { name: short(p.provider) };
    for (const s of series) {
      // Coerce undefined to 0 for safe charting
      row[s.key] = ((p as any)[s.key] ?? 0) as number;
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
  return (
    <div className="w-full h-[420px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis tickFormatter={yTickFormatter}
          />
          <Tooltip formatter={(value: any, name) => [yTickFormatter ? yTickFormatter(Number(value)) : value, name as string]} />
          <Legend />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} fill={s.color} name={s.label ?? s.key} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
