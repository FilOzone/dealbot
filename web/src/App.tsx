import { useState } from "react";
import { DailyMetricsCharts } from "./components/DailyMetricsCharts";
import { ErrorState } from "./components/ErrorState";
import { FailedDeals } from "./components/FailedDeals";
import { FailedRetrievals } from "./components/FailedRetrievals";
import { InfrastructureInfo } from "./components/InfrastructureInfo";
import { ModeToggle } from "./components/mode-toggle";
import { ProviderCards } from "./components/ProviderCards";
import { Skeleton } from "./components/Skeleton";
import { SummaryCards } from "./components/SummaryCards";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { useDailyMetrics } from "./hooks/useDailyMetrics";
import { useDealbotConfig } from "./hooks/useDealbotConfig";
import { useFailedDeals } from "./hooks/useFailedDeals";
import { useFailedRetrievals } from "./hooks/useFailedRetrievals";
import { useNetworkStats } from "./hooks/useNetworkStats";
import { useProviders } from "./hooks/useProviders";
import { ServiceType } from "./types/services";

/**
 * Main application component
 * Displays network statistics, provider performance, and daily metrics
 */

export default function App() {
  // Filter state
  const [activeOnly, setActiveOnly] = useState(true); // Default to showing only active providers
  const [approvedOnly, setApprovedOnly] = useState(false);

  // Failed deals filter state
  const [failedDealsSearch, setFailedDealsSearch] = useState("");
  const [failedDealsProvider, setFailedDealsProvider] = useState("");

  // Failed retrievals filter state
  const [failedRetrievalsSearch, setFailedRetrievalsSearch] = useState("");
  const [failedRetrievalsProvider, setFailedRetrievalsProvider] = useState("");
  const [failedRetrievalsServiceType, setFailedRetrievalsServiceType] = useState<ServiceType | "all">("all");

  // Fetch data using new hooks
  const { data: networkStats, loading: statsLoading, error: statsError, refetch: refetchStats } = useNetworkStats();
  const { data: dailyMetricsData, error: dailyError } = useDailyMetrics(30);
  const { data: configData, loading: configLoading } = useDealbotConfig();
  const {
    data: failedDealsData,
    loading: failedDealsLoading,
    error: failedDealsError,
  } = useFailedDeals({
    limit: 20,
    spAddress: failedDealsProvider && failedDealsProvider !== "all" ? failedDealsProvider : undefined,
  });
  const {
    data: failedRetrievalsData,
    loading: failedRetrievalsLoading,
    error: failedRetrievalsError,
  } = useFailedRetrievals({
    limit: 20,
    spAddress: failedRetrievalsProvider && failedRetrievalsProvider !== "all" ? failedRetrievalsProvider : undefined,
    serviceType:
      failedRetrievalsServiceType && failedRetrievalsServiceType !== "all" ? failedRetrievalsServiceType : undefined,
  });

  // Providers with pagination and filters
  const {
    providers,
    total: totalProviders,
    page: currentPage,
    limit: itemsPerPage,
    loading: providersLoading,
    error: providersError,
    setOptions: setProviderOptions,
  } = useProviders({
    page: 1,
    limit: 12, // Show 12 providers per page (4 rows of 3 cards)
    activeOnly,
    approvedOnly,
  });

  // Handle page change
  const handlePageChange = (page: number) => {
    setProviderOptions({ page, limit: itemsPerPage, activeOnly, approvedOnly });
    // Scroll to top of providers section
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Handle filter changes
  const handleActiveOnlyChange = (value: boolean) => {
    setActiveOnly(value);
    setProviderOptions({ page: 1, limit: itemsPerPage, activeOnly: value, approvedOnly });
  };

  const handleApprovedOnlyChange = (value: boolean) => {
    setApprovedOnly(value);
    setProviderOptions({ page: 1, limit: itemsPerPage, activeOnly, approvedOnly: value });
  };

  // Calculate total pages
  const totalPages = Math.ceil(totalProviders / itemsPerPage);

  // Loading state
  if (statsLoading || providersLoading) return <Skeleton />;

  // Error state
  if (statsError) {
    return (
      <div className='p-6'>
        <ErrorState message={statsError} onRetry={refetchStats} />
      </div>
    );
  }

  // Don't render if critical data is missing
  if (!networkStats) return null;

  const allProviders = providers || [];
  const dailyMetrics = dailyMetricsData?.dailyMetrics || [];

  return (
    <div className='min-h-screen bg-background text-foreground'>
      <header className='sticky top-0 z-50 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60'>
        <div className='container mx-auto px-6 py-4'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-3'>
              <div className='h-9 w-9 rounded-md bg-primary/20 flex items-center justify-center text-primary font-bold'>
                DB
              </div>
              <div>
                <h1 className='text-lg font-semibold tracking-tight'>Deal Bot</h1>
                <p className='text-xs text-muted-foreground'>Filecoin storage provider metrics</p>
              </div>
            </div>
            <ModeToggle />
          </div>
        </div>
      </header>

      <main className='relative z-10 container mx-auto px-6 py-8 space-y-8'>
        <div className='text-center py-6'>
          <p className='text-sm text-muted-foreground'>Automated deal creation & storage performance monitoring</p>
        </div>

        {/* Infrastructure Configuration - Temporarily disabled until InfrastructureInfo is migrated */}
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

        <SummaryCards stats={networkStats?.overall} />

        <Card>
          <CardHeader>
            <CardTitle>Storage provider performance</CardTitle>
            <CardDescription>
              Showing {allProviders.length} of {totalProviders} providers • Page {currentPage} of {totalPages}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-6'>
            <ProviderCards
              providers={allProviders}
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={totalProviders}
              itemsPerPage={itemsPerPage}
              onPageChange={handlePageChange}
              activeOnly={activeOnly}
              approvedOnly={approvedOnly}
              onActiveOnlyChange={handleActiveOnlyChange}
              onApprovedOnlyChange={handleApprovedOnlyChange}
            />
          </CardContent>
        </Card>

        {/* Daily Metrics Section */}
        {dailyMetrics && dailyMetrics.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Daily metrics trends</CardTitle>
              <CardDescription>Network performance over time ({dailyMetrics.length} days)</CardDescription>
            </CardHeader>
            <CardContent>
              <DailyMetricsCharts dailyMetrics={dailyMetrics} />
            </CardContent>
          </Card>
        )}

        {/* Failed Deals & Retrievals Section with Tabs */}
        <Card>
          <CardHeader>
            <CardTitle>Failure Analysis</CardTitle>
            <CardDescription>
              Track and analyze failed deals and retrievals • Click to expand for details
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue='deals' className='w-full'>
              <TabsList className='grid w-full grid-cols-2 mb-4'>
                <TabsTrigger value='deals'>
                  Failed Deals
                  {failedDealsData && ` (${failedDealsData.summary.totalFailedDeals})`}
                </TabsTrigger>
                <TabsTrigger value='retrievals'>
                  Failed Retrievals
                  {failedRetrievalsData && ` (${failedRetrievalsData.summary.totalFailedRetrievals})`}
                </TabsTrigger>
              </TabsList>

              <TabsContent value='deals'>
                {failedDealsLoading ? (
                  <div className='text-center py-12'>
                    <p className='text-muted-foreground'>Loading failed deals...</p>
                  </div>
                ) : failedDealsError ? (
                  <ErrorState message={failedDealsError} onRetry={() => window.location.reload()} />
                ) : failedDealsData ? (
                  <FailedDeals
                    data={failedDealsData}
                    searchValue={failedDealsSearch}
                    providerFilter={failedDealsProvider}
                    onSearchChange={setFailedDealsSearch}
                    onProviderFilterChange={setFailedDealsProvider}
                    providers={allProviders.map((p) => ({ address: p.provider.address, name: p.provider.name }))}
                  />
                ) : null}
              </TabsContent>

              <TabsContent value='retrievals'>
                {failedRetrievalsLoading ? (
                  <div className='text-center py-12'>
                    <p className='text-muted-foreground'>Loading failed retrievals...</p>
                  </div>
                ) : failedRetrievalsError ? (
                  <ErrorState message={failedRetrievalsError} onRetry={() => window.location.reload()} />
                ) : failedRetrievalsData ? (
                  <FailedRetrievals
                    data={failedRetrievalsData}
                    searchValue={failedRetrievalsSearch}
                    providerFilter={failedRetrievalsProvider}
                    serviceTypeFilter={failedRetrievalsServiceType}
                    onSearchChange={setFailedRetrievalsSearch}
                    onProviderFilterChange={setFailedRetrievalsProvider}
                    onServiceTypeFilterChange={setFailedRetrievalsServiceType}
                    providers={allProviders.map((p) => ({ address: p.provider.address, name: p.provider.name }))}
                  />
                ) : null}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Provider Daily Comparison Section */}
        {/* {allProviders.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Provider performance trends</CardTitle>
              <CardDescription>Compare individual provider performance over time (last 30 days)</CardDescription>
            </CardHeader>
            <CardContent>
              <ProviderComparison providers={allProviders} days={30} />
            </CardContent>
          </Card>
        )} */}

        {/* Daily Metrics Error State */}
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

        {/* Provider Error State */}
        {providersError && (
          <Card>
            <CardHeader>
              <CardTitle>Provider data unavailable</CardTitle>
              <CardDescription>Unable to load provider performance data</CardDescription>
            </CardHeader>
            <CardContent>
              <ErrorState message={providersError} onRetry={() => window.location.reload()} />
            </CardContent>
          </Card>
        )}
      </main>

      <footer className='relative z-10 mt-20 py-8 border-t'>
        <div className='container mx-auto px-6'>
          <div className='flex flex-col lg:flex-row items-center justify-between gap-6'>
            <div>
              <p className='text-sm font-semibold'>Mini Deal Bot Analytics</p>
              <p className='text-sm text-muted-foreground'>Automated storage deals on Filecoin network</p>
              <p className='text-xs text-muted-foreground mt-1'>
                CDN A/B testing • Performance tracking • Real-time monitoring
              </p>
            </div>

            <div>
              <p className='text-sm font-medium'>Open Source</p>
              <a
                href='https://github.com/FilOzone/dealbot'
                target='_blank'
                rel='noopener noreferrer'
                className='text-sm text-muted-foreground hover:text-foreground transition-colors'
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
