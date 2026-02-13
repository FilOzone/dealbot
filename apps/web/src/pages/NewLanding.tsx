import { useEffect, useMemo, useState } from "react";
import type { DateRange, OnSelectHandler } from "react-day-picker";
import { useSearchParams } from "react-router-dom";
import ProvidersTable from "@/components/NewLanding/ProvidersTable";
import TimeWindowSelector from "@/components/shared/TimeWindowSelector";
import { useProvidersQuery } from "@/hooks/useProvidersQuery";
import type { PresetValue, TimeWindow } from "@/lib/time-window";
import { parseTimeWindowFromURL, serializeTimeWindowToURL } from "@/lib/time-window";

export default function NewLanding() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [timeWindow, setTimeWindow] = useState<TimeWindow>(() => parseTimeWindowFromURL(searchParams));

  useEffect(() => {
    const params = serializeTimeWindowToURL(timeWindow);
    const currentParams = searchParams.toString();
    const newParams = params.toString();

    if (currentParams !== newParams) {
      setSearchParams(params, { replace: true });
    }
  }, [timeWindow, searchParams, setSearchParams]);

  const queryOptions = useMemo(() => {
    if (timeWindow.preset) {
      return { preset: timeWindow.preset };
    }
    if (timeWindow.range.from && timeWindow.range.to) {
      return {
        startDate: timeWindow.range.from.toISOString(),
        endDate: timeWindow.range.to.toISOString(),
      };
    }
    return {};
  }, [timeWindow]);

  const { data, isLoading, error } = useProvidersQuery(queryOptions);

  const handleDateRange: OnSelectHandler<DateRange> = (range) => {
    setTimeWindow((prev) => ({
      range,
      preset: range.from && range.to ? undefined : prev.preset,
    }));
  };

  const handlePresetSelect = (preset: PresetValue) => {
    setTimeWindow((prev) => ({
      preset,
      range: {
        ...prev.range,
        to: undefined,
      },
    }));
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-muted-foreground">Assessment Window:</span>
          <TimeWindowSelector
            timeWindow={timeWindow}
            onDateRangeSelect={handleDateRange}
            onPresetSelect={handlePresetSelect}
          />
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-xl font-semibold">Storage Providers</h2>
        <ProvidersTable data={data?.data} isLoading={isLoading} error={error} />
      </div>
    </div>
  );
}
