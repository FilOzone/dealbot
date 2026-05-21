import { useNetworkConfig } from "@/hooks/useNetworkConfig";
import { NETWORK_DOT_CLASS, NETWORK_LABEL } from "./constants";

function NetworkBadge({ className }: { className?: string }) {
  const { network, loading, error } = useNetworkConfig();

  if (loading) {
    return (
      <span className={`inline-block h-6 w-40 animate-pulse rounded-full bg-muted ${className ?? ""}`} aria-hidden />
    );
  }

  if (error || network === null) return null;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs sm:text-sm font-medium ${className ?? ""}`}
      title={`This dealbot instance monitors ${NETWORK_LABEL[network]}`}
    >
      <span className={`h-2 w-2 rounded-full ${NETWORK_DOT_CLASS[network]}`} aria-hidden />
      <span className="text-muted-foreground">Network:</span>
      <span>{NETWORK_LABEL[network]}</span>
    </span>
  );
}

export default NetworkBadge;
