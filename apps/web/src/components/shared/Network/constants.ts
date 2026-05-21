import type { Network } from "@/types/config";

export const NETWORK_DEPLOYMENT_URL: Record<Network, string> = {
  mainnet: "https://dealbot.filoz.org",
  calibration: "https://staging.dealbot.filoz.org",
};

export const NETWORK_LABEL: Record<Network, string> = {
  mainnet: "Mainnet",
  calibration: "Calibration",
};

export const NETWORK_DOT_CLASS: Record<Network, string> = {
  mainnet: "bg-emerald-500",
  calibration: "bg-amber-500",
};
