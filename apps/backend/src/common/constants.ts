import { stringToHex } from "viem";
import type { Network } from "./types.js";

export const CDN_HOSTNAMES: Record<Network, string> = {
  calibration: "calibration.filcdn.io",
  // TODO: Verify mainnet CDN hostname
  mainnet: "mainnet.filcdn.io",
};

export const DEFAULT_LOCAL_DATASETS_PATH = "./datasets";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const MAX_BLOCK_SIZE = 5 * 1024 * 1024;

export const DEV_TAG = stringToHex("dev");
