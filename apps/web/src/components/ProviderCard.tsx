import { AlertCircle, BarChart3, Check, Copy, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import { useProviderVersion } from "@/hooks/useProviderVersion";
import type { ProviderCombinedPerformance, ProviderDetailResponse } from "@/types/providers";
import { formatMilliseconds, formatThroughput } from "@/utils/formatter";
import { calculateProviderHealth } from "@/utils/providerHealth";
import { formatRegion } from "@/utils/regionFormatter";
import { ProviderDetailModal } from "./ProviderDetailModal";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Skeleton } from "./ui/skeleton";

interface ProviderCardProps {
  provider: ProviderCombinedPerformance;
  batchedVersion?: string;
}

interface MetricRowProps {
  label: string;
  allTimeAttempts: number;
  allTimeRate: number;
  weeklyAttempts: number;
  weeklyRate: number;
  successThreshold?: number;
}

const SUCCESS_RATE_THRESHOLD = 90;

/**
 * MetricRow component displays success rate metrics in a table format
 * Shows all-time and 7-day attempts and success rates side by side
 */
function MetricRow({
  label,
  allTimeAttempts,
  allTimeRate,
  weeklyAttempts,
  weeklyRate,
  successThreshold = SUCCESS_RATE_THRESHOLD,
}: MetricRowProps) {
  const formatRate = (rate: number) => `${Number(rate).toFixed(1)}%`;
  const getRateColor = (rate: number) => (rate < successThreshold ? "text-red-600" : "text-green-600");

  return (
    <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] gap-2 py-2 text-sm border-b last:border-b-0">
      <div className="font-medium text-foreground">{label}</div>
      <div className="text-right text-muted-foreground">{allTimeAttempts.toLocaleString()}</div>
      <div className={`text-right font-semibold ${getRateColor(allTimeRate)}`}>{formatRate(allTimeRate)}</div>
      <div className="text-right text-muted-foreground">{weeklyAttempts.toLocaleString()}</div>
      <div className={`text-right font-semibold ${getRateColor(weeklyRate)}`}>{formatRate(weeklyRate)}</div>
    </div>
  );
}

/**
 * LatencyMetricRow component displays latency metrics with proper aggregation labels
 */
function LatencyMetricRow({
  label,
  value,
  aggregation = "Avg",
}: {
  label: string;
  value: number;
  aggregation?: string;
}) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">
        {aggregation} {label}
      </span>
      <span className="font-medium">{formatMilliseconds(value)}</span>
    </div>
  );
}

export function ProviderCard({ provider, batchedVersion }: ProviderCardProps) {
  const [copiedProvider, setCopiedProvider] = useState<string | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const { version, loading, error } = useProviderVersion({
    serviceUrl: provider.provider.serviceUrl,
    batchedVersion,
  });

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
        const avg7dRate =
          (Number(provider.weekly!.dealSuccessRate) + Number(provider.weekly!.retrievalSuccessRate)) / 2;
        return avg7dRate > avgAllTimeRate + 2;
      })()
    : false;

  const isDegrading = hasMetrics
    ? (() => {
        const avgAllTimeRate =
          (Number(provider.allTime!.dealSuccessRate) + Number(provider.allTime!.retrievalSuccessRate)) / 2;
        const avg7dRate =
          (Number(provider.weekly!.dealSuccessRate) + Number(provider.weekly!.retrievalSuccessRate)) / 2;
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
      <CardHeader className="pb-4">
        {/* Header with name and status badges */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold truncate">
              {provider.provider.name || "Unnamed Provider"} ({provider.provider.providerId || "N/A"})
            </h3>
            <div className="flex items-center gap-2 mt-2">
              <code className="text-xs bg-muted px-2 py-1 rounded font-mono truncate max-w-[220px]">
                {provider.provider.address}
              </code>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => copyToClipboard(provider.provider.address, provider.provider.address)}
              >
                {copiedProvider === provider.provider.address ? (
                  <Check className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Badge variant={provider.provider.isActive ? "default" : "secondary"} className="justify-center">
              {provider.provider.isActive ? "Testing" : "Inactive"}
            </Badge>
            <Badge
              variant={provider.provider.isApproved ? "default" : "outline"}
              className={
                provider.provider.isApproved ? "bg-green-600 hover:bg-green-700 justify-center" : "justify-center"
              }
            >
              {provider.provider.isApproved ? "Approved" : "Pending"}
            </Badge>
          </div>
        </div>

        {/* Description */}
        {provider.provider.description && (
          <p className="text-sm text-muted-foreground mt-3 line-clamp-2">{provider.provider.description}</p>
        )}

        {/* SP Curio Version */}
        {error ? null : loading ? (
          <Skeleton className="h-5 w-full" />
        ) : version ? (
          <div className="text-sm flex justify-between items-center gap-2 mb-0">
            <p className="text-sm text-muted-foreground">Curio Version:</p>
            <span className="font-medium">{version}</span>
          </div>
        ) : null}

        {/* Health Status Banner */}
        {hasMetrics && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t">
            <div className="flex items-center gap-2">
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
              <span className="text-sm font-medium">{health.label}</span>
            </div>
            {isImproving && (
              <div className="flex items-center gap-1.5 text-green-600">
                <TrendingUp className="h-4 w-4" />
                <span className="text-xs font-medium">Improving</span>
              </div>
            )}
            {isDegrading && (
              <div className="flex items-center gap-1.5 text-orange-600">
                <TrendingDown className="h-4 w-4" />
                <span className="text-xs font-medium">Declining</span>
              </div>
            )}
          </div>
        )}

        {/* Health Warnings */}
        {hasMetrics && (health.status === "warning" || health.status === "critical") && health.reasons.length > 0 && (
          <div className="mt-3 p-3 bg-muted/50 rounded-md border border-muted">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-orange-600" />
              <div className="flex-1 min-w-0">
                <ul className="text-xs space-y-1 text-muted-foreground">
                  {health.reasons.slice(0, 2).map((reason, idx) => (
                    <li key={idx}>{reason}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-5 pt-0">
        {/* Provider Info Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Region</span>
            <span className="font-medium">{formatRegion(provider.provider.region)}</span>
          </div>
          {provider.provider.serviceUrl && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Service URL</span>
              <div className="flex items-center gap-1.5">
                <code className="text-xs bg-muted px-2 py-1 rounded font-mono truncate max-w-[160px]">
                  {provider.provider.serviceUrl}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => copyToClipboard(provider.provider.serviceUrl, provider.provider.serviceUrl)}
                >
                  {copiedProvider === provider.provider.serviceUrl ? (
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Performance Metrics - Only show if metrics exist */}
        {hasMetrics && (
          <>
            {/* Success Rates Table */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-semibold mb-3">Success Rates</h4>
              <div className="bg-muted/30 rounded-lg p-3">
                {/* Table Header */}
                <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] gap-2 pb-2 text-xs font-semibold text-muted-foreground border-b mb-1">
                  <div>Metric</div>
                  <div className="text-right">All Time</div>
                  <div className="text-right">Rate</div>
                  <div className="text-right">7 Days</div>
                  <div className="text-right">Rate</div>
                </div>

                {/* Uploads */}
                <MetricRow
                  label="Uploads"
                  allTimeAttempts={provider.allTime!.totalDeals}
                  allTimeRate={provider.allTime!.dealSuccessRate}
                  weeklyAttempts={provider.weekly!.totalDeals}
                  weeklyRate={provider.weekly!.dealSuccessRate}
                />

                {/* SP /piece Retrieval */}
                <MetricRow
                  label="SP /piece Retrieval"
                  allTimeAttempts={provider.allTime!.totalRetrievals}
                  allTimeRate={provider.allTime!.retrievalSuccessRate}
                  weeklyAttempts={provider.weekly!.totalRetrievals}
                  weeklyRate={provider.weekly!.retrievalSuccessRate}
                />

                {/* IPNI Indexing */}
                {provider.allTime!.totalIpniDeals > 0 && (
                  <MetricRow
                    label="IPNI Indexing"
                    allTimeAttempts={provider.allTime!.totalIpniDeals}
                    allTimeRate={provider.allTime!.ipniSuccessRate}
                    weeklyAttempts={provider.weekly!.totalIpniDeals}
                    weeklyRate={provider.weekly!.ipniSuccessRate}
                  />
                )}

                {/* IPFS Mainnet Retrieval */}
                {provider.allTime!.totalIpfsRetrievals > 0 && (
                  <MetricRow
                    label="IPFS Mainnet Retrieval"
                    allTimeAttempts={provider.allTime!.totalIpfsRetrievals}
                    allTimeRate={provider.allTime!.ipfsRetrievalSuccessRate}
                    weeklyAttempts={provider.weekly!.totalIpfsRetrievals}
                    weeklyRate={provider.weekly!.ipfsRetrievalSuccessRate}
                  />
                )}
              </div>
            </div>

            {/* Latency Metrics Section */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-semibold mb-3">Latency Metrics (All Time)</h4>
              <div className="space-y-2">
                {/* Upload Latencies */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Upload</p>
                  <div className="pl-2 space-y-1">
                    <LatencyMetricRow label="Ingest Latency" value={provider.allTime!.avgIngestLatencyMs} />
                    <LatencyMetricRow label="Chain Latency" value={provider.allTime!.avgChainLatencyMs} />
                    <LatencyMetricRow label="Deal Latency" value={provider.allTime!.avgDealLatencyMs} />
                  </div>
                </div>

                {/* SP Retrieval Latencies */}
                <div className="space-y-1.5 pt-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    SP /piece Retrieval
                  </p>
                  <div className="pl-2 space-y-1">
                    <LatencyMetricRow label="Latency" value={provider.allTime!.avgRetrievalLatencyMs} />
                    <LatencyMetricRow label="TTFB" value={provider.allTime!.avgRetrievalTtfbMs} />
                  </div>
                </div>

                {/* IPNI Latencies */}
                {provider.allTime!.totalIpniDeals > 0 && (
                  <div className="space-y-1.5 pt-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">IPNI Indexing</p>
                    <div className="pl-2 space-y-1">
                      <LatencyMetricRow label="Time to Index" value={provider.allTime!.avgIpniTimeToIndexMs} />
                      <LatencyMetricRow label="Time to Advertise" value={provider.allTime!.avgIpniTimeToAdvertiseMs} />
                      <LatencyMetricRow
                        label="Time to Retrieve Request"
                        value={provider.allTime!.avgIpniTimeToRetrieveMs}
                      />
                      <LatencyMetricRow label="Time to Verify" value={provider.allTime!.avgIpniTimeToVerifyMs} />
                    </div>
                  </div>
                )}

                {/* IPFS Retrieval Latencies */}
                {provider.allTime!.totalIpfsRetrievals > 0 && (
                  <div className="space-y-1.5 pt-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      IPFS Mainnet Retrieval
                    </p>
                    <div className="pl-2 space-y-1">
                      <LatencyMetricRow label="Latency" value={provider.allTime!.avgIpfsRetrievalLatencyMs} />
                      <LatencyMetricRow label="TTFB" value={provider.allTime!.avgIpfsRetrievalTtfbMs} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Throughput Section */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-semibold mb-3">Avg Throughput (All Time)</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Upload Ingest</p>
                  <p className="text-sm font-medium">
                    {formatThroughput(provider.allTime!.avgIngestThroughputBps ?? 0)}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">SP /piece Retrieval</p>
                  <p className="text-sm font-medium">
                    {formatThroughput(provider.allTime!.avgRetrievalThroughputBps ?? 0)}
                  </p>
                </div>
                {provider.allTime!.totalIpfsRetrievals > 0 && provider.allTime!.avgIpfsRetrievalThroughputBps > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">IPFS Mainnet Retrieval</p>
                    <p className="text-sm font-medium">
                      {formatThroughput(provider.allTime!.avgIpfsRetrievalThroughputBps ?? 0)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* No Metrics Message */}
        {!hasMetrics && (
          <div className="border-t pt-6 pb-2 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted mb-3">
              <AlertCircle className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium mb-1">No Performance Data</p>
            <p className="text-xs text-muted-foreground">
              This provider is registered but hasn't completed any deals or retrievals yet
            </p>
          </div>
        )}

        {/* View Details Button */}
        {hasMetrics && (
          <div className="border-t pt-4">
            <Button variant="outline" className="w-full" onClick={() => setShowDetailModal(true)}>
              <BarChart3 className="h-4 w-4 mr-2" />
              View Detailed Metrics
            </Button>
          </div>
        )}
      </CardContent>

      {/* Detail Modal */}
      <ProviderDetailModal provider={provider.provider} open={showDetailModal} onOpenChange={setShowDetailModal} />
    </Card>
  );
}
