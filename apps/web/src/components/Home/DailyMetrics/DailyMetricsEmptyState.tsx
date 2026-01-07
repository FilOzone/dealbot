import { BarChart3 } from "lucide-react";

export function DailyMetricsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
        <BarChart3 className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">No Metrics Data Available</h3>
      <p className="text-sm text-muted-foreground max-w-md">
        Daily metrics data is not available yet. This could be because the system is still collecting data or no metrics
        have been recorded in the past 30 days.
      </p>
    </div>
  );
}
