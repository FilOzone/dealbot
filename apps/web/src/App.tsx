import { Config, StorageProviders, SummaryCards } from "@/components/Home";
import DailyMetrics from "@/components/Home/DailyMetrics";
import FailedDealsAndRetrievals from "@/components/Home/FailedDealsAndRetrievals";
import { Footer, Header } from "@/components/shared";

/**
 * Main application component
 * Displays network statistics, provider performance, and daily metrics
 */
export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="relative z-10 container mx-auto px-6 py-8 space-y-8">
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
      </main>

      <Footer />
    </div>
  );
}
