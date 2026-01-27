import type { ProviderPerformanceDto } from "@/types/providers";
import { calculateSuccessRate } from "@/utils/calculations";
import { formatPercentage } from "@/utils/formatters";

interface ProviderCardQuickStatsProps {
  weeklyMetrics: ProviderPerformanceDto;
}

function ProviderCardQuickStats({ weeklyMetrics }: ProviderCardQuickStatsProps) {
  const totalAttempts = Number(weeklyMetrics.totalDeals) + Number(weeklyMetrics.totalRetrievals);
  const totalSuccesses = Number(weeklyMetrics.successfulDeals) + Number(weeklyMetrics.successfulRetrievals);
  const combinedSuccessRate = calculateSuccessRate(totalSuccesses, totalAttempts);

  return (
    <div className="mt-4 pt-4 border-t">
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Upload Success</p>
          <p className="font-semibold text-lg">{formatPercentage(weeklyMetrics.dealSuccessRate)}</p>
          <p className="text-xs text-muted-foreground">{weeklyMetrics.totalDeals} attempts (7d)</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Retrieval Success</p>
          <p className="font-semibold text-lg">{formatPercentage(weeklyMetrics.retrievalSuccessRate)}</p>
          <p className="text-xs text-muted-foreground">{weeklyMetrics.totalRetrievals} attempts (7d)</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Total Success</p>
          <p className="font-semibold text-lg">{formatPercentage(combinedSuccessRate)}</p>
          <p className="text-xs text-muted-foreground">{totalAttempts} attempts (7d)</p>
        </div>
      </div>
    </div>
  );
}

export default ProviderCardQuickStats;
