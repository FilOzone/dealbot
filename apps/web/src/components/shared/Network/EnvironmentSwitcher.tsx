import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveNetworks } from "@/hooks/useActiveNetworks";
import { ENVIRONMENT_LABEL, NETWORK_DEPLOYMENT_URL, NETWORK_DOT_CLASS } from "./constants";

/**
 * Header control that links to the sibling deployment for the other environment.
 *
 * Environment is determined by which networks the current deployment monitors:
 * - Active networks include mainnet → Production deployment → link to Staging
 * - Active networks are calibration-only → Staging deployment → link to Production
 */
export default function EnvironmentSwitcher() {
  const { activeNetworks, loading, error } = useActiveNetworks();

  if (loading) {
    return <div className="h-8 w-8 sm:w-40 animate-pulse rounded-md bg-muted" aria-hidden />;
  }

  if (error || activeNetworks.length === 0) return null;

  const isProduction = activeNetworks.includes("mainnet");
  const targetEnv = isProduction ? "calibration" : "mainnet";
  const label = `Switch to ${ENVIRONMENT_LABEL[targetEnv]}`;

  return (
    <Button asChild variant="outline" size="sm" title={label} aria-label={label}>
      <a href={NETWORK_DEPLOYMENT_URL[targetEnv]} rel="noreferrer">
        <span className={`h-2 w-2 rounded-full ${NETWORK_DOT_CLASS[targetEnv]}`} aria-hidden />
        <ArrowLeftRight className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{ENVIRONMENT_LABEL[targetEnv]}</span>
      </a>
    </Button>
  );
}
