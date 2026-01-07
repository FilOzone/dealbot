import { ErrorState } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDailyMetrics } from "@/hooks/useDailyMetrics";
import type { DailyAggregatedMetrics } from "@/types/metrics";
import DailyMetricsCharts from "./DailyMetricsCharts";
import { DailyMetricsEmptyState } from "./DailyMetricsEmptyState";
import { DailyMetricsSkeleton } from "./DailyMetricsSkeleton";

const DailyMetrics = () => {
  const { data, loading, error } = useDailyMetrics(30);

  const dailyMetrics = data?.dailyMetrics || [];
  const hasData = !loading && !error && dailyMetrics.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily metrics trends</CardTitle>
        {hasData && <CardDescription>Network performance over time ({dailyMetrics.length} days)</CardDescription>}
      </CardHeader>
      <CardContent>
        <DailyMetricsContent loading={loading} error={error} dailyMetrics={dailyMetrics} />
      </CardContent>
    </Card>
  );
};

export default DailyMetrics;

interface DailyMetricsContentProps {
  loading: boolean;
  error: string | null;
  dailyMetrics: DailyAggregatedMetrics[];
}

function DailyMetricsContent({ loading, error, dailyMetrics }: DailyMetricsContentProps) {
  if (loading) {
    return <DailyMetricsSkeleton />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  }

  if (dailyMetrics.length === 0) {
    return <DailyMetricsEmptyState />;
  }

  return <DailyMetricsCharts dailyMetrics={dailyMetrics} />;
}
