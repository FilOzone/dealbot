import { useState } from "react";
import { useProviderMetrics } from "../hooks/useProviderMetrics";
import type { ProviderCombinedPerformance } from "../types/providers";
import { ErrorState } from "./ErrorState";
import { ProviderDailyComparison } from "./ProviderDailyComparison";
import { Skeleton } from "./Skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

/**
 * Multi-provider comparison component
 * Allows selecting a provider and viewing their daily performance trends
 */
interface ProviderComparisonProps {
  providers: ProviderCombinedPerformance[];
  days?: number;
}

export function ProviderComparison({ providers, days = 30 }: ProviderComparisonProps) {
  // Default to first provider with activity
  const defaultProvider =
    providers.find((p) => p.weekly && p.allTime)?.weekly?.spAddress || providers[0]?.weekly?.spAddress;
  const [selectedProvider, setSelectedProvider] = useState<string>(defaultProvider || "");

  // Fetch daily metrics for selected provider
  const { data, loading, error, refetch } = useProviderMetrics(selectedProvider, { days });

  if (!selectedProvider || providers.length === 0) {
    return (
      <div className='text-center py-8 text-muted-foreground'>
        <p>No providers available for comparison.</p>
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* Provider Selector */}
      <div className='flex items-center gap-4'>
        <label htmlFor='provider-select' className='text-sm font-medium'>
          Select Provider:
        </label>
        <Select value={selectedProvider} onValueChange={setSelectedProvider}>
          <SelectTrigger id='provider-select' className='w-[300px]'>
            <SelectValue placeholder='Choose a provider' />
          </SelectTrigger>
          <SelectContent>
            {providers.map((provider) => {
              const address = provider.weekly?.spAddress || provider.allTime?.spAddress;
              if (!address) return null;

              return (
                <SelectItem key={address} value={address}>
                  {address}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Loading State */}
      {loading && (
        <div className='space-y-4'>
          <Skeleton />
        </div>
      )}

      {/* Error State */}
      {error && !loading && <ErrorState message={error} onRetry={refetch} />}

      {/* Charts */}
      {data && !loading && !error && (
        <div className='space-y-4'>
          <div className='text-sm text-muted-foreground'>
            Showing {data.dailyMetrics.length} days of data for{" "}
            <span className='font-mono font-medium'>{data.spAddress}</span>
          </div>
          <ProviderDailyComparison metrics={data.dailyMetrics} />
        </div>
      )}
    </div>
  );
}
