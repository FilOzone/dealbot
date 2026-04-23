import { ArrowLeftRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useNetworkConfig } from "@/hooks/useNetworkConfig";
import type { Network } from "@/types/config";
import { NETWORK_DEPLOYMENT_URL, NETWORK_DOT_CLASS, NETWORK_LABEL } from "./constants";

const otherNetwork = (network: Network): Network => (network === "mainnet" ? "calibration" : "mainnet");

/**
 * Provides a link to the sibling deployment for the other network.
 */
export default function NetworkSwitcher() {
  const { network, loading, error } = useNetworkConfig();

  if (loading) {
    return <div className="h-8 w-8 sm:w-36 animate-pulse rounded-md bg-muted" aria-hidden />;
  }

  if (error || network === null) return null;

  const other = otherNetwork(network);
  const label = `Switch to ${NETWORK_LABEL[other]}`;
  return (
    <Button asChild variant="outline" size="sm" title={label} aria-label={label}>
      <Link to={NETWORK_DEPLOYMENT_URL[other]} target="_blank" rel="noopener noreferrer">
        <span className={`h-2 w-2 rounded-full ${NETWORK_DOT_CLASS[other]}`} aria-hidden />
        <ArrowLeftRight className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{NETWORK_LABEL[other]}</span>
      </Link>
    </Button>
  );
}
