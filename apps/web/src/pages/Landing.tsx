import { Config, DailyMetrics, FailedDealsAndRetrievals, StorageProviders, SummaryCards } from "@/components/Home";

export default function Landing() {
  return (
    <>
      <div className="text-center py-6">
        <p className="text-sm text-muted-foreground">Automated deal creation & storage performance monitoring</p>
      </div>

      {/* Infrastructure Configuration */}
      <Config />

      {/* Statistics */}
      <SummaryCards />

      {/* Storage Providers */}
      <StorageProviders />

      {/* Daily Metrics Section */}
      <DailyMetrics />

      {/* Failed Deals & Retrievals Section with Tabs */}
      <FailedDealsAndRetrievals />
    </>
  );
}
