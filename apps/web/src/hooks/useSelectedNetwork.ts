import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { Network } from "@/types/config";

/**
 * Derives the selected network from the `?network=` URL search param, falling
 * back to `activeNetworks[0]` when the param is absent or invalid.
 *
 * Returns the selected network and a stable setter that writes the param to the
 * URL (replacing history so network switches don't stack in the back button).
 *
 * Returns `[null, setter]` while `activeNetworks` is still empty (loading).
 */
export function useSelectedNetwork(activeNetworks: Network[]): [Network | null, (n: Network) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const param = searchParams.get("network") as Network | null;
  const selected = param !== null && activeNetworks.includes(param) ? param : (activeNetworks[0] ?? null);

  const setSelectedNetwork = useCallback(
    (network: Network) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("network", network);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return [selected, setSelectedNetwork];
}
