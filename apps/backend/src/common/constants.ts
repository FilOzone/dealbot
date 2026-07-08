import { stringToHex } from "viem";

export const DEFAULT_LOCAL_DATASETS_PATH = "./datasets";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const MAX_BLOCK_SIZE = 5 * 1024 * 1024;

export const DEV_TAG = stringToHex("dev");

// First network will be used as default in absence of NETWORKS config
export const SUPPORTED_NETWORKS = ["calibration", "mainnet"] as const;

/**
 * Fixed metadata marker key tagging every throwaway data set created by the
 * `data_set_lifecycle_check` job. The value is a per-run nonce; the key is the stable
 * handle operators use to list/sweep leaked sets (create-OK / terminate-failed runs).
 */
export const LIFECYCLE_CHECK_METADATA_KEY = "dealbotLifecycleCheck";
