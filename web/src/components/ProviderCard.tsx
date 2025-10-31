import { AlertCircle, Check, Copy, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import type { ProviderCombinedPerformance, ProviderDetailResponse } from "@/types/providers";
import { formatMilliseconds, formatThroughput } from "@/utils/formatter";
import { calculateProviderHealth } from "@/utils/providerHealth";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";

interface ProviderCardProps {
  provider: ProviderCombinedPerformance;
}

const SUCCESS_RATE_THRESHOLD = 90;

export function ProviderCard({ provider }: ProviderCardProps) {
  const [copiedProvider, setCopiedProvider] = useState<string | null>(null);

  const hasMetrics = provider.weekly && provider.allTime;

  const copyToClipboard = async (text: string, providerId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedProvider(providerId);
      setTimeout(() => setCopiedProvider(null), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatNumber = (num: number | string) => num.toLocaleString();
  const formatPercentage = (pct: number | string) => `${Number(pct).toFixed(1)}%`;

  // Calculate health and trends only if metrics exist
  const health = hasMetrics
    ? calculateProviderHealth(provider as ProviderDetailResponse)
    : {
        status: "inactive" as const,
        label: "No Metrics",
        color: "text-muted-foreground",
        bgColor: "bg-muted/30",
        borderColor: "border-muted",
        reasons: [],
      };

  const isImproving = hasMetrics
    ? (() => {
        const avgAllTimeRate =
          (Number(provider.allTime!.dealSuccessRate) + Number(provider.allTime!.retrievalSuccessRate)) / 2;
        const avg7dRate = (Number(provider.weekly!.dealSuccessRate) + Number(provider.weekly!.retrievalSuccessRate)) / 2;
        return avg7dRate > avgAllTimeRate + 2;
      })()
    : false;

  const isDegrading = hasMetrics
    ? (() => {
        const avgAllTimeRate =
          (Number(provider.allTime!.dealSuccessRate) + Number(provider.allTime!.retrievalSuccessRate)) / 2;
        const avg7dRate = (Number(provider.weekly!.dealSuccessRate) + Number(provider.weekly!.retrievalSuccessRate)) / 2;
        return avgAllTimeRate > avg7dRate + 5;
      })()
    : false;

  // Get health status color
  const getHealthColor = () => {
    if (!hasMetrics) return "border-l-muted";
    switch (health.status) {
      case "excellent":
        return "border-l-green-500";
      case "good":
        return "border-l-blue-500";
      case "warning":
        return "border-l-yellow-500";
      case "critical":
        return "border-l-red-500";
      default:
        return "border-l-muted";
    }
  };

  return (
    <Card className={`relative border-l-4 ${getHealthColor()} transition-all hover:shadow-lg`}>
      <CardHeader className='pb-4'>
        {/* Header with name and status badges */}
        <div className='flex items-start justify-between gap-3'>
          <div className='flex-1 min-w-0'>
            <h3 className='text-lg font-semibold truncate'>{provider.provider.name || "Unnamed Provider"}</h3>
            <div className='flex items-center gap-2 mt-2'>
              <code className='text-xs bg-muted px-2 py-1 rounded font-mono truncate max-w-[220px]'>
                {provider.provider.address}
              </code>
              <Button
                variant='ghost'
                size='sm'
                className='h-7 w-7 p-0'
                onClick={() => copyToClipboard(provider.provider.address, provider.provider.address)}
              >
                {copiedProvider === provider.provider.address ? (
                  <Check className='h-3.5 w-3.5 text-green-600' />
                ) : (
                  <Copy className='h-3.5 w-3.5' />
                )}
              </Button>
            </div>
          </div>
          <div className='flex flex-col gap-2'>
            <Badge variant={provider.provider.isActive ? "default" : "secondary"} className='justify-center'>
              {provider.provider.isActive ? "Testing" : "Inactive"}
            </Badge>
            <Badge
              variant={provider.provider.isApproved ? "default" : "outline"}
              className={provider.provider.isApproved ? "bg-green-600 hover:bg-green-700 justify-center" : "justify-center"}
            >
              {provider.provider.isApproved ? "Approved" : "Pending"}
            </Badge>
          </div>
        </div>

        {/* Description */}
        {provider.provider.description && (
          <p className='text-sm text-muted-foreground mt-3 line-clamp-2'>{provider.provider.description}</p>
        )}

        {/* Health Status Banner */}
        {hasMetrics && (
          <div className='flex items-center justify-between mt-3 pt-3 border-t'>
            <div className='flex items-center gap-2'>
              <div
                className={`h-2 w-2 rounded-full ${
                  health.status === "excellent"
                    ? "bg-green-500"
                    : health.status === "good"
                      ? "bg-blue-500"
                      : health.status === "warning"
                        ? "bg-yellow-500"
                        : "bg-red-500"
                }`}
              />
              <span className='text-sm font-medium'>{health.label}</span>
            </div>
            {isImproving && (
              <div className='flex items-center gap-1.5 text-green-600'>
                <TrendingUp className='h-4 w-4' />
                <span className='text-xs font-medium'>Improving</span>
              </div>
            )}
            {isDegrading && (
              <div className='flex items-center gap-1.5 text-orange-600'>
                <TrendingDown className='h-4 w-4' />
                <span className='text-xs font-medium'>Declining</span>
              </div>
            )}
          </div>
        )}

        {/* Health Warnings */}
        {hasMetrics && (health.status === "warning" || health.status === "critical") && health.reasons.length > 0 && (
          <div className='mt-3 p-3 bg-muted/50 rounded-md border border-muted'>
            <div className='flex items-start gap-2'>
              <AlertCircle className='h-4 w-4 mt-0.5 flex-shrink-0 text-orange-600' />
              <div className='flex-1 min-w-0'>
                <ul className='text-xs space-y-1 text-muted-foreground'>
                  {health.reasons.slice(0, 2).map((reason, idx) => (
                    <li key={idx}>{reason}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className='space-y-5 pt-0'>
        {/* Provider Info Section */}
        <div className='space-y-3'>
          <div className='flex items-center justify-between text-sm'>
            <span className='text-muted-foreground'>Region</span>
            <span className='font-medium'>{provider.provider.region || "Unknown"}</span>
          </div>
          {hasMetrics && (
            <div className='flex items-center justify-between text-sm'>
              <span className='text-muted-foreground'>Last Activity</span>
              <span className='font-medium text-xs'>{formatDate(new Date(provider.allTime!.lastDealAt))}</span>
            </div>
          )}
          {provider.provider.serviceUrl && (
            <div className='flex items-center justify-between gap-2'>
              <span className='text-sm text-muted-foreground'>Service URL</span>
              <div className='flex items-center gap-1.5'>
                <code className='text-xs bg-muted px-2 py-1 rounded font-mono truncate max-w-[160px]'>
                  {provider.provider.serviceUrl}
                </code>
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-7 w-7 p-0'
                  onClick={() => copyToClipboard(provider.provider.serviceUrl, provider.provider.serviceUrl)}
                >
                  {copiedProvider === provider.provider.serviceUrl ? (
                    <Check className='h-3.5 w-3.5 text-green-600' />
                  ) : (
                    <Copy className='h-3.5 w-3.5' />
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Performance Metrics - Only show if metrics exist */}
        {hasMetrics && (
          <>
            <div className='border-t pt-4'>
              <h4 className='text-sm font-semibold mb-3'>Activity Overview</h4>
              <div className='grid grid-cols-2 gap-4'>
                <div className='space-y-1'>
                  <p className='text-xs text-muted-foreground'>Total Deals</p>
                  <p className='text-2xl font-bold'>{formatNumber(provider.allTime!.totalDeals)}</p>
                </div>
                <div className='space-y-1'>
                  <p className='text-xs text-muted-foreground'>Total Retrievals</p>
                  <p className='text-2xl font-bold'>{formatNumber(provider.allTime!.totalRetrievals)}</p>
                </div>
              </div>
            </div>

            <div className='border-t pt-4'>
              <h4 className='text-sm font-semibold mb-3'>Success Rates</h4>
              <div className='space-y-3'>
                <div>
                  <div className='flex items-center justify-between mb-1'>
                    <span className='text-sm text-muted-foreground'>Deal Success (All Time)</span>
                    <span
                      className={`text-sm font-semibold ${
                        provider.allTime!.dealSuccessRate < SUCCESS_RATE_THRESHOLD
                          ? "text-red-600"
                          : "text-green-600"
                      }`}
                    >
                      {formatPercentage(provider.allTime!.dealSuccessRate)}
                    </span>
                  </div>
                  <div className='w-full bg-muted rounded-full h-2'>
                    <div
                      className={`h-2 rounded-full transition-all ${
                        provider.allTime!.dealSuccessRate < SUCCESS_RATE_THRESHOLD ? "bg-red-600" : "bg-green-600"
                      }`}
                      style={{ width: `${Math.min(provider.allTime!.dealSuccessRate, 100)}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className='flex items-center justify-between mb-1'>
                    <span className='text-sm text-muted-foreground'>Retrieval Success (All Time)</span>
                    <span
                      className={`text-sm font-semibold ${
                        provider.allTime!.retrievalSuccessRate < SUCCESS_RATE_THRESHOLD
                          ? "text-red-600"
                          : "text-green-600"
                      }`}
                    >
                      {formatPercentage(provider.allTime!.retrievalSuccessRate)}
                    </span>
                  </div>
                  <div className='w-full bg-muted rounded-full h-2'>
                    <div
                      className={`h-2 rounded-full transition-all ${
                        provider.allTime!.retrievalSuccessRate < SUCCESS_RATE_THRESHOLD ? "bg-red-600" : "bg-green-600"
                      }`}
                      style={{ width: `${Math.min(provider.allTime!.retrievalSuccessRate, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className='border-t pt-4'>
              <h4 className='text-sm font-semibold mb-3'>7-Day Performance</h4>
              <div className='grid grid-cols-2 gap-3'>
                <div className='space-y-1'>
                  <p className='text-xs text-muted-foreground'>Deal Success</p>
                  <p
                    className={`text-lg font-semibold ${
                      provider.weekly!.dealSuccessRate < SUCCESS_RATE_THRESHOLD ? "text-red-600" : "text-green-600"
                    }`}
                  >
                    {formatPercentage(provider.weekly!.dealSuccessRate)}
                  </p>
                </div>
                <div className='space-y-1'>
                  <p className='text-xs text-muted-foreground'>Retrieval Success</p>
                  <p
                    className={`text-lg font-semibold ${
                      provider.weekly!.retrievalSuccessRate < SUCCESS_RATE_THRESHOLD ? "text-red-600" : "text-green-600"
                    }`}
                  >
                    {formatPercentage(provider.weekly!.retrievalSuccessRate)}
                  </p>
                </div>
              </div>
              {provider.weekly!.refreshedAt && (
                <p className='text-xs text-muted-foreground mt-2'>
                  Last updated: {formatDate(new Date(provider.weekly!.refreshedAt))}
                </p>
              )}
            </div>

            <div className='border-t pt-4'>
              <h4 className='text-sm font-semibold mb-3'>Latency Metrics</h4>
              <div className='grid grid-cols-2 gap-y-2 gap-x-4 text-sm'>
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>Ingest</span>
                  <span className='font-medium'>{formatMilliseconds(provider.allTime!.avgIngestLatencyMs)}</span>
                </div>
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>Chain</span>
                  <span className='font-medium'>{formatMilliseconds(provider.allTime!.avgChainLatencyMs)}</span>
                </div>
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>Deal</span>
                  <span className='font-medium'>{formatMilliseconds(provider.allTime!.avgDealLatencyMs)}</span>
                </div>
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>Retrieval</span>
                  <span className='font-medium'>{formatMilliseconds(provider.allTime!.avgRetrievalLatencyMs)}</span>
                </div>
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>TTFB</span>
                  <span className='font-medium'>{formatMilliseconds(provider.allTime!.avgRetrievalTtfbMs)}</span>
                </div>
              </div>
            </div>

            <div className='border-t pt-4'>
              <h4 className='text-sm font-semibold mb-3'>Throughput</h4>
              <div className='grid grid-cols-2 gap-3'>
                <div className='space-y-1'>
                  <p className='text-xs text-muted-foreground'>Ingest</p>
                  <p className='text-sm font-medium'>{formatThroughput(provider.allTime!.avgIngestThroughputBps ?? 0)}</p>
                </div>
                <div className='space-y-1'>
                  <p className='text-xs text-muted-foreground'>Retrieval</p>
                  <p className='text-sm font-medium'>
                    {formatThroughput(provider.allTime!.avgRetrievalThroughputBps ?? 0)}
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* No Metrics Message */}
        {!hasMetrics && (
          <div className='border-t pt-6 pb-2 text-center'>
            <div className='inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted mb-3'>
              <AlertCircle className='h-6 w-6 text-muted-foreground' />
            </div>
            <p className='text-sm font-medium mb-1'>No Performance Data</p>
            <p className='text-xs text-muted-foreground'>
              This provider is registered but hasn't completed any deals or retrievals yet
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
