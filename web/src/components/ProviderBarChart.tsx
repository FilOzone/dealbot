import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { ProviderPerformanceDto } from "../types/stats";
import type { MetricKey } from "../App";

function short(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function toChartData(list: ProviderPerformanceDto[], metric: MetricKey) {
  return [...list]
    .sort((a, b) => (b[metric] as number) - (a[metric] as number))
    .map((p) => ({ name: short(p.provider), value: p[metric] as number }));
}

export function ProviderBarChart({ data, metric }: { data: ProviderPerformanceDto[]; metric: MetricKey }) {
  const chartData = toChartData(data, metric);
  return (
    <div className="w-full h-[420px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData}>
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Bar dataKey="value" fill="#3b82f6" name={metric} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
