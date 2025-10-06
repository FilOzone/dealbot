import { useState } from "react";
import { useOverallStats } from "./hooks/useOverallStats";
import { useDailyStats } from "./hooks/useDailyStats";
import { useDealbotConfig } from "./hooks/useDealbotConfig";
import { ProviderCards } from "./components/ProviderCards";
import { SummaryCards } from "./components/SummaryCards";
import { DailyMetricsCharts } from "./components/DailyMetricsCharts";
import { ProviderDailyComparison } from "./components/ProviderDailyComparison";
import { ProviderFilter } from "./components/ProviderFilter";
import { ErrorState } from "./components/ErrorState";
import { Skeleton } from "./components/Skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { ModeToggle } from "./components/mode-toggle";
import { FailedDeals } from "./components/FailedDeals";
import { useFailedDeals } from "./hooks/useFailedDeals";
import { InfrastructureInfo } from "./components/InfrastructureInfo";
import { calculateProviderHealth, filterProvidersByHealth, type HealthStatus } from "./utils/providerHealth";

export type MetricKey =
  | "dealSuccessRate"
  | "retrievalSuccessRate"
  | "ingestLatency"
  | "chainLatency"
  | "dealLatency"
  | "retrievalLatency"
  | "retrievalTtfb"
  | "ingestThroughput"
  | "retrievalThroughput"
  | "totalDeals"
  | "totalRetrievals";

export default function App() {
  const { data, loading, error, refetch } = useOverallStats();
  const { data: dailyData, loading: dailyLoading, error: dailyError } = useDailyStats();
  const { data: configData, loading: configLoading } = useDealbotConfig();

  // Provider filters state
  const [providerSearch, setProviderSearch] = useState("");
  const [providerHealthFilter, setProviderHealthFilter] = useState<HealthStatus[]>([]);
  const [providerSortBy, setProviderSortBy] = useState<"name" | "health" | "deals" | "retrievals">("health");
  const [providerSortOrder, setProviderSortOrder] = useState<"asc" | "desc">("asc");

  // Failed deals filters state
  const [failedDealsPage, setFailedDealsPage] = useState(1);
  const [failedDealsSearch, setFailedDealsSearch] = useState("");
  const [failedDealsProvider, setFailedDealsProvider] = useState("all");
  const [failedDealsCDN, setFailedDealsCDN] = useState<boolean | undefined>(undefined);

  const { data: failedDealsData, error: failedDealsError } = useFailedDeals({
    page: failedDealsPage,
    limit: 10,
    search: failedDealsSearch,
    provider: failedDealsProvider === "all" ? undefined : failedDealsProvider,
    withCDN: failedDealsCDN,
  });

  if (loading || dailyLoading) return <Skeleton />;
  if (error)
    return (
      <div className="p-6">
        <ErrorState message={error} onRetry={refetch} />
      </div>
    );
  if (!data) return null;

  const allProviders = data.overallStats.providerPerformance;

  // Filter and sort providers
  let filteredProviders = allProviders;

  // Apply search filter
  if (providerSearch) {
    const searchLower = providerSearch.toLowerCase();
    filteredProviders = filteredProviders.filter(
      (p) =>
        p.name.toLowerCase().includes(searchLower) ||
        p.provider.toLowerCase().includes(searchLower) ||
        p.description?.toLowerCase().includes(searchLower),
    );
  }

  // Apply health status filter
  if (providerHealthFilter.length > 0) {
    filteredProviders = filterProvidersByHealth(filteredProviders, providerHealthFilter);
  }

  // Sort providers
  filteredProviders = [...filteredProviders].sort((a, b) => {
    let compareValue = 0;

    switch (providerSortBy) {
      case "name":
        compareValue = a.name.localeCompare(b.name);
        break;
      case "health":
        const healthA = calculateProviderHealth(a).score;
        const healthB = calculateProviderHealth(b).score;
        compareValue = healthA - healthB;
        break;
      case "deals":
        compareValue = a.totalDeals - b.totalDeals;
        break;
      case "retrievals":
        compareValue = a.totalRetrievals - b.totalRetrievals;
        break;
    }

    return providerSortOrder === "asc" ? compareValue : -compareValue;
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-md bg-primary/20 flex items-center justify-center text-primary font-bold">
                DB
              </div>
              <div>
                <h1 className="text-lg font-semibold tracking-tight">Deal Bot</h1>
                <p className="text-xs text-muted-foreground">Filecoin storage provider metrics</p>
              </div>
            </div>
            <ModeToggle />
          </div>
        </div>
      </header>

      <main className="relative z-10 container mx-auto px-6 py-8 space-y-8">
        <div className="text-center py-6">
          <p className="text-sm text-muted-foreground">Automated deal creation & storage performance monitoring</p>
        </div>

        {/* Infrastructure Configuration */}
        {configData && !configLoading && (
          <Card>
            <CardHeader>
              <CardTitle>Infrastructure configuration</CardTitle>
              <CardDescription>Dealbot operational parameters and scheduling frequencies</CardDescription>
            </CardHeader>
            <CardContent>
              <InfrastructureInfo config={configData} />
            </CardContent>
          </Card>
        )}

        <SummaryCards stats={data.overallStats} />

        <Card>
          <CardHeader>
            <CardTitle>Storage provider performance</CardTitle>
            <CardDescription>
              {filteredProviders.length} of {allProviders.length} providers shown • Sorted by{" "}
              {providerSortBy === "health"
                ? "health score"
                : providerSortBy === "name"
                  ? "name"
                  : providerSortBy === "deals"
                    ? "total deals"
                    : "total retrievals"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ProviderFilter
              searchValue={providerSearch}
              onSearchChange={setProviderSearch}
              healthFilter={providerHealthFilter}
              onHealthFilterChange={setProviderHealthFilter}
              sortBy={providerSortBy}
              onSortChange={setProviderSortBy}
              sortOrder={providerSortOrder}
              onSortOrderChange={setProviderSortOrder}
            />
            <ProviderCards providers={filteredProviders} />
          </CardContent>
        </Card>

        {/* Daily Metrics Section */}
        {dailyData && dailyData.dailyMetrics.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Daily metrics trends</CardTitle>
              <CardDescription>
                CDN vs Direct performance over time ({dailyData.summary.totalDays} days)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DailyMetricsCharts dailyMetrics={dailyData.dailyMetrics} />
            </CardContent>
          </Card>
        )}

        {/* Provider Daily Comparison Section */}
        {dailyData && dailyData.dailyMetrics.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Provider performance trends</CardTitle>
              <CardDescription>
                Daily performance trends by provider over {dailyData.summary.totalDays} days
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProviderDailyComparison dailyMetrics={dailyData.dailyMetrics} />
            </CardContent>
          </Card>
        )}

        {/* Failed Deals Section */}
        {failedDealsData && (
          <Card>
            <CardHeader>
              <CardTitle>Failed Deals Analysis</CardTitle>
              <CardDescription>
                Search, filter, and analyze failed deals with detailed error information
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FailedDeals
                data={failedDealsData}
                onPageChange={(page) => setFailedDealsPage(page)}
                onSearchChange={(search) => {
                  setFailedDealsSearch(search);
                  setFailedDealsPage(1);
                }}
                onProviderFilter={(provider) => {
                  setFailedDealsProvider(provider);
                  setFailedDealsPage(1);
                }}
                onCDNFilter={(withCDN) => {
                  setFailedDealsCDN(withCDN);
                  setFailedDealsPage(1);
                }}
                currentFilters={{
                  search: failedDealsSearch,
                  provider: failedDealsProvider,
                  withCDN: failedDealsCDN,
                }}
              />
            </CardContent>
          </Card>
        )}

        {/* Failed Deals Error State */}
        {failedDealsError && (
          <Card>
            <CardHeader>
              <CardTitle>Failed deals unavailable</CardTitle>
              <CardDescription>Unable to load failed deals data</CardDescription>
            </CardHeader>
            <CardContent>
              <ErrorState message={failedDealsError} onRetry={() => window.location.reload()} />
            </CardContent>
          </Card>
        )}

        {/* Daily Error State */}
        {dailyError && (
          <Card>
            <CardHeader>
              <CardTitle>Daily metrics unavailable</CardTitle>
              <CardDescription>Unable to load daily metrics data</CardDescription>
            </CardHeader>
            <CardContent>
              <ErrorState message={dailyError} onRetry={() => window.location.reload()} />
            </CardContent>
          </Card>
        )}
      </main>

      <footer className="relative z-10 mt-20 py-8 border-t">
        <div className="container mx-auto px-6">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
            <div>
              <p className="text-sm font-semibold">Mini Deal Bot Analytics</p>
              <p className="text-sm text-muted-foreground">Automated storage deals on Filecoin network</p>
              <p className="text-xs text-muted-foreground mt-1">
                CDN A/B testing • Performance tracking • Real-time monitoring
              </p>
            </div>

            <div>
              <p className="text-sm font-medium">Open Source</p>
              <a
                href="https://github.com/FilOzone/dealbot"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                github.com/FilOzone/dealbot
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
