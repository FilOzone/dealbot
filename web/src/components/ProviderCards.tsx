import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Copy, Check } from "lucide-react";
import type { ProviderPerformanceDto } from "../types/stats";

interface ProviderCardsProps {
  providers: ProviderPerformanceDto[];
}

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
  const formatLatency = (ms: number) => `${Math.round(ms)} ms`;
  const formatPercentage = (pct: number) => `${pct.toFixed(2)}%`;
  const formatThroughput = (throughput: number) => `${formatNumber(throughput)}/s`;

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {providers.map((provider) => (
        <Card key={provider.provider} className="relative">
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <CardTitle className="text-lg font-semibold truncate">{provider.name || provider.provider}</CardTitle>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-xs bg-muted px-2 py-1 rounded font-mono truncate max-w-[200px]">
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
              <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{provider.description}</p>
            )}
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Provider Details */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Provider Details</h4>
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
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-muted-foreground">Service Url:</span>
                  <code className="text-xs bg-muted px-2 py-1 rounded font-mono truncate max-w-[200px]">
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
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Performance Metrics</h4>

              {/* Counts */}
              <div>
                <h5 className="text-xs font-medium text-muted-foreground mb-1">Counts</h5>
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
                <h5 className="text-xs font-medium text-muted-foreground mb-1">Success Rates</h5>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Deal:</span>
                    <span className="ml-1 font-medium text-green-600">
                      {formatPercentage(provider.dealSuccessRate)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Retrieval:</span>
                    <span className="ml-1 font-medium text-green-600">
                      {formatPercentage(provider.retrievalSuccessRate)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Latencies */}
              <div>
                <h5 className="text-xs font-medium text-muted-foreground mb-1">Latencies</h5>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Ingest:</span>
                    <span className="ml-1 font-medium">{formatLatency(provider.ingestLatency)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Chain:</span>
                    <span className="ml-1 font-medium">{formatLatency(provider.chainLatency)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Deal:</span>
                    <span className="ml-1 font-medium">{formatLatency(provider.dealLatency)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Retrieval:</span>
                    <span className="ml-1 font-medium">{formatLatency(provider.retrievalLatency)}</span>
                  </div>
                </div>
              </div>

              {/* Throughput */}
              <div>
                <h5 className="text-xs font-medium text-muted-foreground mb-1">Throughput</h5>
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
      ))}
    </div>
  );
}
