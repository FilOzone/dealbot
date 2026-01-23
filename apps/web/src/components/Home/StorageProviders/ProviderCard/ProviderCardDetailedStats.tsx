import { BarChart3, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Provider, ProviderPerformanceDto } from "@/types/providers";
import { formatThroughput } from "@/utils/formatter";
import { formatRegion } from "@/utils/regionFormatter";
import LatencyMetricRow from "./LatencyMetricRow";
import MetricRow from "./MetricRow";

interface ProviderCardDetailedStatsProps {
  provider: Provider;
  allTimeMetrics: ProviderPerformanceDto;
  weeklyMetrics: ProviderPerformanceDto;
  copiedProvider: string | null;
  onCopy: (text: string, providerId: string) => void;
  onViewDetails: () => void;
}

function ProviderCardDetailedStats({
  provider,
  allTimeMetrics,
  weeklyMetrics,
  copiedProvider,
  onCopy,
  onViewDetails,
}: ProviderCardDetailedStatsProps) {
  return (
    <>
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Region</span>
          <span className="font-medium">{formatRegion(provider.region)}</span>
        </div>
        {provider.serviceUrl && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">Service URL</span>
            <div className="flex items-center gap-1.5">
              <code className="text-xs bg-muted px-2 py-1 rounded font-mono truncate max-w-[160px]">
                {provider.serviceUrl}
              </code>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => onCopy(provider.serviceUrl, provider.serviceUrl)}
              >
                {copiedProvider === provider.serviceUrl ? (
                  <Check className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t pt-4">
        <h4 className="text-sm font-semibold mb-3">Success Rates</h4>
        <div className="bg-muted/30 rounded-lg p-3">
          <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] gap-2 pb-2 text-xs font-semibold text-muted-foreground border-b mb-1">
            <div>Metric</div>
            <div className="text-right">All Time</div>
            <div className="text-right">Rate</div>
            <div className="text-right">7 Days</div>
            <div className="text-right">Rate</div>
          </div>

          <MetricRow
            label="Uploads"
            allTimeAttempts={allTimeMetrics.totalDeals}
            allTimeRate={allTimeMetrics.dealSuccessRate}
            weeklyAttempts={weeklyMetrics.totalDeals}
            weeklyRate={weeklyMetrics.dealSuccessRate}
          />

          <MetricRow
            label="SP /piece Retrieval"
            allTimeAttempts={allTimeMetrics.totalRetrievals}
            allTimeRate={allTimeMetrics.retrievalSuccessRate}
            weeklyAttempts={weeklyMetrics.totalRetrievals}
            weeklyRate={weeklyMetrics.retrievalSuccessRate}
          />

          {allTimeMetrics.totalIpniDeals > 0 && (
            <MetricRow
              label="IPNI Indexing"
              allTimeAttempts={allTimeMetrics.totalIpniDeals}
              allTimeRate={allTimeMetrics.ipniSuccessRate}
              weeklyAttempts={weeklyMetrics.totalIpniDeals}
              weeklyRate={weeklyMetrics.ipniSuccessRate}
            />
          )}

          {allTimeMetrics.totalIpfsRetrievals > 0 && (
            <MetricRow
              label="IPFS Mainnet Retrieval"
              allTimeAttempts={allTimeMetrics.totalIpfsRetrievals}
              allTimeRate={allTimeMetrics.ipfsRetrievalSuccessRate}
              weeklyAttempts={weeklyMetrics.totalIpfsRetrievals}
              weeklyRate={weeklyMetrics.ipfsRetrievalSuccessRate}
            />
          )}
        </div>
      </div>

      <div className="border-t pt-4">
        <h4 className="text-sm font-semibold mb-3">Latency Metrics (All Time)</h4>
        <div className="space-y-2">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Upload</p>
            <div className="pl-2 space-y-1">
              <LatencyMetricRow label="Ingest Latency" value={allTimeMetrics.avgIngestLatencyMs} />
              <LatencyMetricRow label="Chain Latency" value={allTimeMetrics.avgChainLatencyMs} />
              <LatencyMetricRow label="Deal Latency" value={allTimeMetrics.avgDealLatencyMs} />
            </div>
          </div>

          <div className="space-y-1.5 pt-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">SP /piece Retrieval</p>
            <div className="pl-2 space-y-1">
              <LatencyMetricRow label="Latency" value={allTimeMetrics.avgRetrievalLatencyMs} />
              <LatencyMetricRow label="TTFB" value={allTimeMetrics.avgRetrievalTtfbMs} />
            </div>
          </div>

          {allTimeMetrics.totalIpniDeals > 0 && (
            <div className="space-y-1.5 pt-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">IPNI Indexing</p>
              <div className="pl-2 space-y-1">
                <LatencyMetricRow label="Time to Index" value={allTimeMetrics.avgIpniTimeToIndexMs} />
                <LatencyMetricRow label="Time to Advertise" value={allTimeMetrics.avgIpniTimeToAdvertiseMs} />
                <LatencyMetricRow label="Time to Verify" value={allTimeMetrics.avgIpniTimeToVerifyMs} />
              </div>
            </div>
          )}

          {allTimeMetrics.totalIpfsRetrievals > 0 && (
            <div className="space-y-1.5 pt-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                IPFS Mainnet Retrieval
              </p>
              <div className="pl-2 space-y-1">
                <LatencyMetricRow label="Latency" value={allTimeMetrics.avgIpfsRetrievalLatencyMs} />
                <LatencyMetricRow label="TTFB" value={allTimeMetrics.avgIpfsRetrievalTtfbMs} />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t pt-4">
        <h4 className="text-sm font-semibold mb-3">Avg Throughput (All Time)</h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Upload Ingest</p>
            <p className="text-sm font-medium">{formatThroughput(allTimeMetrics.avgIngestThroughputBps ?? 0)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">SP /piece Retrieval</p>
            <p className="text-sm font-medium">{formatThroughput(allTimeMetrics.avgRetrievalThroughputBps ?? 0)}</p>
          </div>
          {allTimeMetrics.totalIpfsRetrievals > 0 && allTimeMetrics.avgIpfsRetrievalThroughputBps > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">IPFS Mainnet Retrieval</p>
              <p className="text-sm font-medium">
                {formatThroughput(allTimeMetrics.avgIpfsRetrievalThroughputBps ?? 0)}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="border-t pt-4">
        <Button variant="outline" className="w-full" onClick={onViewDetails}>
          <BarChart3 className="h-4 w-4 mr-2" />
          View Detailed Metrics
        </Button>
      </div>
    </>
  );
}

export default ProviderCardDetailedStats;
