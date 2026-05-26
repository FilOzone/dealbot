import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Network } from "@/types/config";
import { NETWORK_DOT_CLASS, NETWORK_LABEL } from "./constants";

interface NetworkSwitcherProps {
  networks: Network[];
  selected: Network;
  onChange: (network: Network) => void;
}

/**
 * In-page tab control for switching between the active networks of a
 * multi-network deployment. Renders nothing when only one network is active.
 */
export default function NetworkSwitcher({ networks, selected, onChange }: NetworkSwitcherProps) {
  if (networks.length <= 1) return null;

  return (
    <Tabs value={selected} onValueChange={(v) => onChange(v as Network)}>
      <TabsList aria-label="Select network">
        {networks.map((network) => (
          <TabsTrigger key={network} value={network} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${NETWORK_DOT_CLASS[network]}`} aria-hidden />
            {NETWORK_LABEL[network]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
