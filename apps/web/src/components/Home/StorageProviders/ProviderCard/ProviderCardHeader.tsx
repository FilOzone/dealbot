import { AlertCircle, Check, Copy, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Provider } from "@/types/providers";

interface ProviderCardHeaderProps {
  provider: Provider;
  version?: string;
  versionLoading: boolean;
  versionError: string | null;
  hasMetrics: boolean;
  health: {
    status: string;
    label: string;
    reasons: string[];
  };
  isImproving: boolean;
  isDegrading: boolean;
  copiedProvider: string | null;
  onCopy: (text: string, providerId: string) => void;
}

function ProviderCardHeader({
  provider,
  version,
  versionLoading,
  versionError,
  hasMetrics,
  health,
  isImproving,
  isDegrading,
  copiedProvider,
  onCopy,
}: ProviderCardHeaderProps) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold truncate">
            {provider.name || "Unnamed Provider"} ({provider.providerId || "N/A"})
          </h3>
          <div className="flex items-center gap-2 mt-2">
            <code className="text-xs bg-muted px-2 py-1 rounded font-mono truncate max-w-[220px]">
              {provider.address}
            </code>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => onCopy(provider.address, provider.address)}
            >
              {copiedProvider === provider.address ? (
                <Check className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Badge variant={provider.isActive ? "default" : "secondary"} className="justify-center">
            {provider.isActive ? "Testing" : "Inactive"}
          </Badge>
          <Badge
            variant={provider.isApproved ? "default" : "outline"}
            className={provider.isApproved ? "bg-green-600 hover:bg-green-700 justify-center" : "justify-center"}
          >
            {provider.isApproved ? "Approved" : "Pending"}
          </Badge>
        </div>
      </div>

      {provider.description && (
        <p className="text-sm text-muted-foreground mt-3 line-clamp-2">{provider.description}</p>
      )}

      {versionError ? null : versionLoading ? (
        <Skeleton className="h-5 w-full" />
      ) : version ? (
        <div className="text-sm flex justify-between items-center gap-2 mb-0">
          <p className="text-sm text-muted-foreground">Curio Version:</p>
          <span className="font-medium">{version}</span>
        </div>
      ) : null}

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
    </>
  );
}

export default ProviderCardHeader;
