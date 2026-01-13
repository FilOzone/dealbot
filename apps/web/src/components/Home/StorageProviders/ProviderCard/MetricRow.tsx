interface MetricRowProps {
  label: string;
  allTimeAttempts: number;
  allTimeRate: number;
  weeklyAttempts: number;
  weeklyRate: number;
  successThreshold?: number;
}

const SUCCESS_RATE_THRESHOLD = 90;

function MetricRow({
  label,
  allTimeAttempts,
  allTimeRate,
  weeklyAttempts,
  weeklyRate,
  successThreshold = SUCCESS_RATE_THRESHOLD,
}: MetricRowProps) {
  const formatRate = (rate: number) => `${Number(rate).toFixed(1)}%`;
  const getRateColor = (rate: number) => (rate < successThreshold ? "text-red-600" : "text-green-600");

  return (
    <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] gap-2 py-2 text-sm border-b last:border-b-0 min-w-[480px]">
      <div className="font-medium text-foreground">{label}</div>
      <div className="text-right text-muted-foreground">{allTimeAttempts.toLocaleString()}</div>
      <div className={`text-right font-semibold ${getRateColor(allTimeRate)}`}>{formatRate(allTimeRate)}</div>
      <div className="text-right text-muted-foreground">{weeklyAttempts.toLocaleString()}</div>
      <div className={`text-right font-semibold ${getRateColor(weeklyRate)}`}>{formatRate(weeklyRate)}</div>
    </div>
  );
}

export default MetricRow;
