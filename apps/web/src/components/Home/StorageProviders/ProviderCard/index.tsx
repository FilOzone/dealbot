import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useProviderVersion } from "@/hooks/useProviderVersion";
import type { ProviderCombinedPerformance, ProviderDetailResponse } from "@/types/providers";
import { calculateProviderHealth } from "@/utils/providerHealth";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import ProviderDetailModal from "../ProviderDetailModal";
import ProviderCardDetailedStats from "./ProviderCardDetailedStats";
import ProviderCardEmptyState from "./ProviderCardEmptyState";
import ProviderCardHeader from "./ProviderCardHeader";
import ProviderCardQuickStats from "./ProviderCardQuickStats";

interface ProviderCardProps {
  provider: ProviderCombinedPerformance;
  batchedVersion?: string;
}

function ProviderCard({ provider, batchedVersion }: ProviderCardProps) {
  const [copiedProvider, setCopiedProvider] = useState<string | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const { version, loading, error } = useProviderVersion({
    serviceUrl: provider.provider.serviceUrl,
    batchedVersion,
  });

  const hasMetrics = !!provider.weekly && !!provider.allTime;

  const copyToClipboard = async (text: string, providerId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedProvider(providerId);
      setTimeout(() => setCopiedProvider(null), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

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
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <Card className={`relative border-l-4 ${getHealthColor()} transition-all hover:shadow-lg`}>
        <CardHeader className="pb-4">
          <ProviderCardHeader
            provider={provider.provider}
            version={version}
            versionLoading={loading}
            versionError={error}
            hasMetrics={hasMetrics}
            health={health}
            isImproving={isImproving}
            isDegrading={isDegrading}
            copiedProvider={copiedProvider}
            onCopy={copyToClipboard}
          />

          {hasMetrics && <ProviderCardQuickStats weeklyMetrics={provider.weekly!} />}
        </CardHeader>

        <CardContent className="space-y-4 pt-0">
          {hasMetrics && (
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="w-full">
                <span className="flex-1">{isExpanded ? "Hide" : "Show"} Detailed Statistics</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
          )}

          <CollapsibleContent className="space-y-5">
            {hasMetrics && (
              <ProviderCardDetailedStats
                provider={provider.provider}
                allTimeMetrics={provider.allTime!}
                weeklyMetrics={provider.weekly!}
                copiedProvider={copiedProvider}
                onCopy={copyToClipboard}
                onViewDetails={() => setShowDetailModal(true)}
              />
            )}
          </CollapsibleContent>

          {!hasMetrics && <ProviderCardEmptyState />}
        </CardContent>

        <ProviderDetailModal provider={provider.provider} open={showDetailModal} onOpenChange={setShowDetailModal} />
      </Card>
    </Collapsible>
  );
}

export default ProviderCard;
