import type { Network } from "@/types/config";

/** External URLs for the sibling deployment of each environment. */
export const NETWORK_DEPLOYMENT_URL: Record<Network, string> = {
  mainnet: "https://dealbot.filoz.org",
  calibration: "https://staging.dealbot.filoz.org",
};

/** Human-readable network name used in the in-page network switcher and badges. */
export const NETWORK_LABEL: Record<Network, string> = {
  mainnet: "Mainnet",
  calibration: "Calibration",
};

/** Tailwind dot color per network. */
export const NETWORK_DOT_CLASS: Record<Network, string> = {
  mainnet: "bg-emerald-500",
  calibration: "bg-amber-500",
};

/**
 * Environment label per network.
 * A deployment whose active networks include mainnet is "Production";
 * a calibration-only deployment is "Staging".
 */
export const ENVIRONMENT_LABEL: Record<Network, string> = {
  mainnet: "Production",
  calibration: "Staging",
};
