import { Activity, Clock, X } from "lucide-react";
import { useState } from "react";
import { useProviderWindow } from "@/hooks/useProviderWindow";
import type { Provider } from "@/types/providers";
import { formatMilliseconds, formatThroughput } from "@/utils/formatter";
import TimeWindowSelector, { type TimeWindow } from "./TimeWindowSelector";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

interface ProviderDetailModalProps {
  provider: Provider;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SUCCESS_RATE_THRESHOLD = 90;

function ProviderDetailModal({ provider, open, onOpenChange }: ProviderDetailModalProps) {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>({
    type: "preset",
    preset: "7d",
    label: "Last 7 Days",
  });

  const { data, loading, error } = useProviderWindow({
    spAddress: provider.address,
    preset: timeWindow.type === "preset" ? timeWindow.preset : undefined,
    startDate: timeWindow.type === "custom" ? timeWindow.startDate?.toISOString().split("T")[0] : undefined,
    endDate: timeWindow.type === "custom" ? timeWindow.endDate?.toISOString().split("T")[0] : undefined,
    enabled: open,
  });

  const formatNumber = (num: number | string) => num.toLocaleString();
  const formatPercentage = (pct: number | string) => `${Number(pct).toFixed(1)}%`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader className='overflow-hidden'>
          <div className='flex gap-2 min-w-0 items-center'>
            <DialogTitle className='text-2xl font-bold truncate'>{provider.name || "Provider Details"}</DialogTitle>
            <div className='flex items-center gap-1'>
              <Badge variant={provider.isActive ? "default" : "secondary"}>
                {provider.isActive ? "Active" : "Inactive"}
              </Badge>
              <Badge
                variant={provider.isApproved ? "default" : "outline"}
                className={provider.isApproved ? "bg-green-600" : ""}
              >
                {provider.isApproved ? "Approved" : "Pending"}
              </Badge>
            </div>
          </div>
          <DialogDescription className='sr-only'>
            View detailed performance metrics for {provider.name || provider.address} across different time windows
          </DialogDescription>
        </DialogHeader>

        {/* Time Window Selector */}
        <div className='border-b pb-4'>
          <div className='flex items-center justify-between gap-4'>
            <div className='flex items-center gap-2'>
              <Clock className='h-4 w-4 text-muted-foreground' />
              <span className='text-sm font-medium'>Time Period</span>
            </div>
            <TimeWindowSelector value={timeWindow} onChange={setTimeWindow} />
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className='space-y-4'>
            <Skeleton className='h-32 w-full' />
            <Skeleton className='h-48 w-full' />
            <Skeleton className='h-48 w-full' />
          </div>
        ) : error ? (
          <div className='text-center py-12'>
            <div className='inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/20 mb-4'>
              <X className='h-8 w-8 text-red-600' />
            </div>
            <p className='text-sm font-medium mb-1'>Failed to Load Data</p>
            <p className='text-xs text-muted-foreground'>{error.message}</p>
          </div>
        ) : data ? (
          <div className='space-y-6'>
            {/* Activity Overview */}
            <div>
              <h3 className='text-lg font-semibold mb-4 flex items-center gap-2'>
                <Activity className='h-5 w-5' />
                Activity Overview
              </h3>
              <div className='grid grid-cols-2 gap-4'>
                <Card>
                  <CardContent className='p-4'>
                    <div className='text-xs uppercase tracking-wide text-muted-foreground'>Total Uploads</div>
                    <div className='mt-2 text-2xl font-semibold'>{formatNumber(data.metrics.totalDeals)}</div>
                    <div className='mt-1 text-xs text-muted-foreground'>
                      {formatNumber(data.metrics.successfulDeals)} Successful Uploads
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className='p-4'>
                    <div className='text-xs uppercase tracking-wide text-muted-foreground'>Total Retrievals</div>
                    <div className='mt-2 text-2xl font-semibold'>{formatNumber(data.metrics.totalRetrievals)}</div>
                    <div className='mt-1 text-xs text-muted-foreground'>
                      {formatNumber(data.metrics.successfulRetrievals)} Successful Retrievals
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Success Rates */}
            <div>
              <h3 className='text-lg font-semibold mb-4'>Success Rates</h3>
              <div className='space-y-4'>
                <div>
                  <div className='flex items-center justify-between mb-2'>
                    <span className='text-sm font-medium'>Upload Success Rate</span>
                    <span
                      className={`text-sm font-semibold ${
                        data.metrics.dealSuccessRate < SUCCESS_RATE_THRESHOLD ? "text-red-600" : "text-green-600"
                      }`}
                    >
                      {formatPercentage(data.metrics.dealSuccessRate)}
                    </span>
                  </div>
                  <div className='w-full bg-muted rounded-full h-3'>
                    <div
                      className={`h-3 rounded-full transition-all ${
                        data.metrics.dealSuccessRate < SUCCESS_RATE_THRESHOLD ? "bg-red-600" : "bg-green-600"
                      }`}
                      style={{
                        width: `${Math.min(data.metrics.dealSuccessRate, 100)}%`,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className='flex items-center justify-between mb-2'>
                    <span className='text-sm font-medium'>Retrieval Success Rate</span>
                    <span
                      className={`text-sm font-semibold ${
                        data.metrics.retrievalSuccessRate < SUCCESS_RATE_THRESHOLD ? "text-red-600" : "text-green-600"
                      }`}
                    >
                      {formatPercentage(data.metrics.retrievalSuccessRate)}
                    </span>
                  </div>
                  <div className='w-full bg-muted rounded-full h-3'>
                    <div
                      className={`h-3 rounded-full transition-all ${
                        data.metrics.retrievalSuccessRate < SUCCESS_RATE_THRESHOLD ? "bg-red-600" : "bg-green-600"
                      }`}
                      style={{
                        width: `${Math.min(data.metrics.retrievalSuccessRate, 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Latency Metrics */}
            <div>
              <h3 className='text-lg font-semibold mb-4'>Latency Metrics</h3>
              <div className='grid grid-cols-2 md:grid-cols-3 gap-4'>
                <div className='bg-card border rounded-lg p-4'>
                  <p className='text-xs text-muted-foreground mb-1'>Ingest Latency</p>
                  <p className='text-lg font-semibold'>{formatMilliseconds(data.metrics.avgIngestLatencyMs)}</p>
                </div>
                <div className='bg-card border rounded-lg p-4'>
                  <p className='text-xs text-muted-foreground mb-1'>Chain Latency</p>
                  <p className='text-lg font-semibold'>{formatMilliseconds(data.metrics.avgChainLatencyMs)}</p>
                </div>
                <div className='bg-card border rounded-lg p-4'>
                  <p className='text-xs text-muted-foreground mb-1'>Deal Latency</p>
                  <p className='text-lg font-semibold'>{formatMilliseconds(data.metrics.avgDealLatencyMs)}</p>
                </div>
                <div className='bg-card border rounded-lg p-4'>
                  <p className='text-xs text-muted-foreground mb-1'>Retrieval Latency</p>
                  <p className='text-lg font-semibold'>{formatMilliseconds(data.metrics.avgRetrievalLatencyMs)}</p>
                </div>
                <div className='bg-card border rounded-lg p-4'>
                  <p className='text-xs text-muted-foreground mb-1'>TTFB</p>
                  <p className='text-lg font-semibold'>{formatMilliseconds(data.metrics.avgRetrievalTtfbMs)}</p>
                </div>
              </div>
            </div>

            {/* Throughput */}
            <div>
              <h3 className='text-lg font-semibold mb-4'>Throughput</h3>
              <div className='grid grid-cols-2 gap-4'>
                <div className='bg-card border rounded-lg p-4'>
                  <p className='text-xs text-muted-foreground mb-1'>Ingest Throughput</p>
                  <p className='text-lg font-semibold'>{formatThroughput(data.metrics.avgIngestThroughputBps ?? 0)}</p>
                </div>
                <div className='bg-card border rounded-lg p-4'>
                  <p className='text-xs text-muted-foreground mb-1'>Retrieval Throughput</p>
                  <p className='text-lg font-semibold'>
                    {formatThroughput(data.metrics.avgRetrievalThroughputBps ?? 0)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default ProviderDetailModal;
