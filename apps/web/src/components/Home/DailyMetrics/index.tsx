import { ErrorState } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDailyMetrics } from "@/hooks/useDailyMetrics";
import DailyMetricsCharts from "./DailyMetricsCharts";
import { DailyMetricsEmptyState } from "./DailyMetricsEmptyState";
import { DailyMetricsSkeleton } from "./DailyMetricsSkeleton";

const DailyMetrics = () => {
  const { data, loading, error } = useDailyMetrics(30);

  const dailyMetrics = data?.dailyMetrics || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily metrics trends</CardTitle>
        {!loading && !error && dailyMetrics.length > 0 && (
          <CardDescription>Network performance over time ({dailyMetrics.length} days)</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <DailyMetricsSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={() => window.location.reload()} />
        ) : dailyMetrics.length === 0 ? (
          <DailyMetricsEmptyState />
        ) : (
          <DailyMetricsCharts dailyMetrics={dailyMetrics} />
        )}
      </CardContent>
    </Card>
  );
};

export default DailyMetrics;
