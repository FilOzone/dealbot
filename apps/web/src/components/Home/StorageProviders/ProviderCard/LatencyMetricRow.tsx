import { formatMilliseconds } from "@/utils/formatter";

interface LatencyMetricRowProps {
  label: string;
  value: number;
  aggregation?: string;
}

function LatencyMetricRow({ label, value, aggregation = "Avg" }: LatencyMetricRowProps) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">
        {aggregation} {label}
      </span>
      <span className="font-medium">{formatMilliseconds(value)}</span>
    </div>
  );
}

export default LatencyMetricRow;
