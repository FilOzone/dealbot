import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Copy, Check, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import type { ProviderPerformanceDto } from "../types/stats";
import { formatMilliseconds, formatThroughput } from "@/utils/formatter";
import { calculateProviderHealth } from "@/utils/providerHealth";

interface ProviderCardsProps {
  providers: ProviderPerformanceDto[];
}

const SUCCESS_RATE_THRESHOLD = 90;

export function ProviderCards({ providers }: ProviderCardsProps) {
  const [copiedProvider, setCopiedProvider] = useState<string | null>(null);

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

  const formatNumber = (num: number) => num.toLocaleString();
  const formatPercentage = (pct: number) => `${pct.toFixed(2)}%`;

  return (
    <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
      {providers.map((provider) => {
        const health = calculateProviderHealth(provider);
        const avgAllTimeRate = (provider.dealSuccessRate + provider.retrievalSuccessRate) / 2;
        const avg7dRate = (provider.dealSuccessRate7d + provider.retrievalSuccessRate7d) / 2;
        const isImproving = avg7dRate > avgAllTimeRate + 2;
        const isDegrading = avgAllTimeRate > avg7dRate + 5;

        return (
          <Card
            key={provider.provider}
            className={`relative border-l-4 ${health.borderColor} transition-all hover:shadow-md`}
          >
            {/* Health Status Banner */}
            <div className={`px-3 py-2 ${health.bgColor} border-b flex items-center justify-between`}>
              <div className="flex items-center gap-1.5">
                <span className="text-sm">{health.icon}</span>
                <span className={`text-xs font-semibold ${health.color}`}>{health.label}</span>
              </div>
              {isImproving && (
                <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                  <TrendingUp className="h-3 w-3" />
                  <span className="text-xs">Improving</span>
                </div>
              )}
              {isDegrading && (
                <div className="flex items-center gap-1 text-orange-600 dark:text-orange-400">
                  <TrendingDown className="h-3 w-3" />
                  <span className="text-xs">Declining</span>
                </div>
              )}
            </div>

            {/* Health Reasons */}
            {(health.status === "warning" || health.status === "critical") && health.reasons.length > 0 && (
              <div className={`px-3 py-2 ${health.bgColor} border-b`}>
                <div className="flex items-start gap-2">
                  <AlertTriangle className={`h-3.5 w-3.5 mt-0.5 flex-shrink-0 ${health.color}`} />
                  <div className="flex-1 min-w-0">
                    <ul className="text-xs space-y-0.5 text-muted-foreground">
                      {health.reasons.slice(0, 2).map((reason, idx) => (
                        <li key={idx} className="leading-snug">
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            <CardHeader className="pb-2 pt-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-base font-semibold truncate">
                    {provider.name || provider.provider}
                  </CardTitle>
                  <div className="flex items-center gap-1.5 mt-1">
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono truncate max-w-[200px]">
                      {provider.provider}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 cursor-pointer"
                      onClick={() => copyToClipboard(provider.provider, provider.provider)}
                    >
                      {copiedProvider === provider.provider ? (
                        <Check className="h-3 w-3 text-green-600" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                </div>
                <Badge variant={provider.isActive ? "default" : "secondary"}>
                  {provider.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
              {provider.description && (
                <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{provider.description}</p>
              )}
            </CardHeader>

            <CardContent className="space-y-3 pt-0">
              {/* Provider Details */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Provider Details
                </h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Payee:</span>
                    <p className="font-mono text-xs truncate">{provider.payee}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Last Deal:</span>
                    <p className="text-xs">{formatDate(provider.lastDealTime)}</p>
                  </div>
                </div>
                {provider.serviceUrl && (
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-xs text-muted-foreground">Service URL:</span>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono truncate max-w-[180px]">
                      {provider.serviceUrl}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 cursor-pointer"
                      onClick={() => copyToClipboard(provider.serviceUrl, provider.serviceUrl)}
                    >
                      {copiedProvider === provider.serviceUrl ? (
                        <Check className="h-3 w-3 text-green-600" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                )}
              </div>

              {/* Performance Metrics */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Performance Metrics
                </h4>

                {/* Counts */}
                <div>
                  <h5 className="text-xs font-medium text-muted-foreground mb-1.5">Counts</h5>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Deals:</span>
                      <span className="ml-1 font-medium">{formatNumber(provider.totalDeals)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Retrievals:</span>
                      <span className="ml-1 font-medium">{formatNumber(provider.totalRetrievals)}</span>
                    </div>
                  </div>
                </div>

                {/* Success Rates */}
                <div>
                  <h5 className="text-xs font-medium text-muted-foreground mb-1.5">Success Rates (All Time)</h5>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Deal:</span>
                      <span
                        className={`ml-1 font-medium ${
                          provider.dealSuccessRate < SUCCESS_RATE_THRESHOLD ? "text-red-600" : "text-green-600"
                        }`}
                      >
                        {formatPercentage(provider.dealSuccessRate)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Retrieval:</span>
                      <span
                        className={`ml-1 font-medium ${
                          provider.retrievalSuccessRate < SUCCESS_RATE_THRESHOLD ? "text-red-600" : "text-green-600"
                        }`}
                      >
                        {formatPercentage(provider.retrievalSuccessRate)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 7-Day Success Rates */}
                <div>
                  <h5 className="text-xs font-medium text-muted-foreground mb-1.5">Success Rates (7-Day)</h5>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Deal:</span>
                      <span
                        className={`ml-1 font-medium ${
                          provider.dealSuccessRate7d < SUCCESS_RATE_THRESHOLD ? "text-red-600" : "text-green-600"
                        }`}
                      >
                        {formatPercentage(provider.dealSuccessRate7d)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Retrieval:</span>
                      <span
                        className={`ml-1 font-medium ${
                          provider.retrievalSuccessRate7d < SUCCESS_RATE_THRESHOLD ? "text-red-600" : "text-green-600"
                        }`}
                      >
                        {formatPercentage(provider.retrievalSuccessRate7d)}
                      </span>
                    </div>
                  </div>
                  {provider.last7dMetricsUpdate && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Updated: {formatDate(provider.last7dMetricsUpdate)}
                    </p>
                  )}
                </div>

                {/* Latencies */}
                <div>
                  <h5 className="text-xs font-medium text-muted-foreground mb-1.5">Latencies</h5>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Ingest:</span>
                      <span className="ml-1 font-medium">{formatMilliseconds(provider.ingestLatency)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Chain:</span>
                      <span className="ml-1 font-medium">{formatMilliseconds(provider.chainLatency)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Deal:</span>
                      <span className="ml-1 font-medium">{formatMilliseconds(provider.dealLatency)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Retrieval:</span>
                      <span className="ml-1 font-medium">{formatMilliseconds(provider.retrievalLatency)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">TTFB:</span>
                      <span className="ml-1 font-medium">{formatMilliseconds(provider.retrievalTTFB)}</span>
                    </div>
                  </div>
                </div>

                {/* Throughput */}
                <div>
                  <h5 className="text-xs font-medium text-muted-foreground mb-1.5">Throughput</h5>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Ingest:</span>
                      <span className="ml-1 font-medium">{formatThroughput(provider.ingestThroughput)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Retrieval:</span>
                      <span className="ml-1 font-medium">{formatThroughput(provider.retrievalThroughput)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
