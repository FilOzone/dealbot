import { Network } from "./types.js";

export const CDN_HOSTNAMES: Record<Network, string> = {
  calibration: "calibration.filcdn.io",
  mainnet: "",
};

export const DEFAULT_LOCAL_DATASETS_PATH = "./datasets";

export const KAGGLE_BASE_URL = "https://www.kaggle.com/api/v1";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
