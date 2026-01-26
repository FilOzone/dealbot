import Joi from "joi";
import { DEFAULT_LOCAL_DATASETS_PATH } from "../common/constants.js";
import type { Network } from "../common/types.js";

export const configValidationSchema = Joi.object({
  // Application
  NODE_ENV: Joi.string().valid("development", "production", "test").default("development"),
  DEALBOT_PORT: Joi.number().default(3000),
  DEALBOT_HOST: Joi.string().default("127.0.0.1"),

  // Database
  DATABASE_HOST: Joi.string().required(),
  DATABASE_PORT: Joi.number().default(5432),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_NAME: Joi.string().required(),

  // Blockchain
  NETWORK: Joi.string().valid("mainnet", "calibration").default("calibration"),
  WALLET_ADDRESS: Joi.string().required(),
  WALLET_PRIVATE_KEY: Joi.string().required(),
  CHECK_DATASET_CREATION_FEES: Joi.boolean().default(true),
  USE_ONLY_APPROVED_PROVIDERS: Joi.boolean().default(true),
  ENABLE_CDN_TESTING: Joi.boolean().default(true),
  ENABLE_IPNI_TESTING: Joi.string()
    .lowercase()
    .valid("disabled", "random", "always", "true", "false")
    .default("always"),
  DEALBOT_DATASET_VERSION: Joi.string().optional(),

  // Scheduling
  DEAL_INTERVAL_SECONDS: Joi.number().default(30),
  RETRIEVAL_INTERVAL_SECONDS: Joi.number()
    .min(1)
    .default(60)
    .custom((value, helpers) => {
      const root = helpers.state.ancestors[0] as {
        RETRIEVAL_TIMEOUT_BUFFER_MS?: number;
        HTTP_REQUEST_TIMEOUT_MS?: number;
        HTTP2_REQUEST_TIMEOUT_MS?: number;
      };
      const bufferMs = typeof root.RETRIEVAL_TIMEOUT_BUFFER_MS === "number" ? root.RETRIEVAL_TIMEOUT_BUFFER_MS : 0;
      const http1TimeoutMs = typeof root.HTTP_REQUEST_TIMEOUT_MS === "number" ? root.HTTP_REQUEST_TIMEOUT_MS : 0;
      const http2TimeoutMs = typeof root.HTTP2_REQUEST_TIMEOUT_MS === "number" ? root.HTTP2_REQUEST_TIMEOUT_MS : 0;
      const requiredMs = Math.max(http1TimeoutMs, http2TimeoutMs);
      const availableMs = value * 1000 - bufferMs;

      if (requiredMs > 0 && availableMs < requiredMs) {
        return helpers.error("any.invalid", {
          message:
            `"RETRIEVAL_INTERVAL_SECONDS" minus "RETRIEVAL_TIMEOUT_BUFFER_MS" must be ` +
            `>= max(HTTP_REQUEST_TIMEOUT_MS, HTTP2_REQUEST_TIMEOUT_MS) (${requiredMs} ms)`,
        });
      }

      return value;
    }),
  DEAL_START_OFFSET_SECONDS: Joi.number().default(0),
  RETRIEVAL_START_OFFSET_SECONDS: Joi.number().default(600),
  METRICS_START_OFFSET_SECONDS: Joi.number().default(900),

  // Kaggle
  DEALBOT_LOCAL_DATASETS_PATH: Joi.string().default(DEFAULT_LOCAL_DATASETS_PATH),
  KAGGLE_DATASET_TOTAL_PAGES: Joi.number().default(500),
  RANDOM_DATASET_SIZES: Joi.string().default("10240,10485760,104857600"), // 10 KiB, 10 MB, 100 MB

  // Proxy
  PROXY_LIST: Joi.string().default(""),
  PROXY_LOCATIONS: Joi.string().default(""),

  // Timeouts (in milliseconds)
  CONNECT_TIMEOUT_MS: Joi.number().min(1000).default(10000), // 10 seconds to establish connection/receive headers
  HTTP_REQUEST_TIMEOUT_MS: Joi.number().min(1000).default(600000), // 10 minutes total for HTTP requests (Body transfer)
  HTTP2_REQUEST_TIMEOUT_MS: Joi.number().min(1000).default(600000), // 10 minutes total for HTTP/2 requests (Body transfer)
  RETRIEVAL_TIMEOUT_BUFFER_MS: Joi.number()
    .min(0)
    .default(60000)
    .custom((value, helpers) => {
      const root = helpers.state.ancestors[0] as { RETRIEVAL_INTERVAL_SECONDS?: number };
      const retrievalIntervalSeconds =
        root && typeof root.RETRIEVAL_INTERVAL_SECONDS === "number" ? root.RETRIEVAL_INTERVAL_SECONDS : undefined;
      if (typeof retrievalIntervalSeconds !== "number" || retrievalIntervalSeconds <= 0) {
        return value;
      }
      const maxBufferMs = retrievalIntervalSeconds * 1000;
      if (value > maxBufferMs) {
        return helpers.error("any.invalid", {
          message: `"RETRIEVAL_TIMEOUT_BUFFER_MS" must be <= RETRIEVAL_INTERVAL_SECONDS * 1000 (${maxBufferMs} ms)`,
        });
      }
      return value;
    }), // Stop retrieval batch 60s before next run
});

export type IpniTestingMode = "disabled" | "random" | "always";

export interface IAppConfig {
  env: string;
  port: number;
  host: string;
}

export interface IDatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export interface IBlockchainConfig {
  network: Network;
  walletAddress: string;
  walletPrivateKey: string;
  checkDatasetCreationFees: boolean;
  useOnlyApprovedProviders: boolean;
  enableCDNTesting: boolean;
  enableIpniTesting: IpniTestingMode;
  dealbotDataSetVersion?: string;
}

export interface ISchedulingConfig {
  dealIntervalSeconds: number;
  retrievalIntervalSeconds: number;
  dealStartOffsetSeconds: number;
  retrievalStartOffsetSeconds: number;
  metricsStartOffsetSeconds: number;
}

export interface IDatasetConfig {
  totalPages: number;
  localDatasetsPath: string;
  randomDatasetSizes: number[];
}

export interface IProxyConfig {
  list: string[];
  locations: string[];
}

export interface ITimeoutConfig {
  connectTimeoutMs: number;
  httpRequestTimeoutMs: number;
  http2RequestTimeoutMs: number;
  retrievalTimeoutBufferMs: number;
}

export interface IFilBeamConfig {
  botToken: string;
}

export interface IConfig {
  app: IAppConfig;
  database: IDatabaseConfig;
  blockchain: IBlockchainConfig;
  scheduling: ISchedulingConfig;
  dataset: IDatasetConfig;
  proxy: IProxyConfig;
  filBeam: IFilBeamConfig;
  timeouts: ITimeoutConfig;
}

const parseIpniTestingMode = (value: string | undefined): IpniTestingMode => {
  if (!value) {
    return "always";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return "always";
  }
  if (normalized === "false") {
    return "disabled";
  }
  if (normalized === "disabled" || normalized === "random" || normalized === "always") {
    return normalized;
  }
  return "always";
};

export function loadConfig(): IConfig {
  return {
    app: {
      env: process.env.NODE_ENV || "development",
      port: Number.parseInt(process.env.DEALBOT_PORT || "3000", 10),
      host: process.env.DEALBOT_HOST || "127.0.0.1",
    },
    database: {
      host: process.env.DATABASE_HOST || "localhost",
      port: Number.parseInt(process.env.DATABASE_PORT || "5432", 10),
      username: process.env.DATABASE_USER || "dealbot",
      password: process.env.DATABASE_PASSWORD || "dealbot_password",
      database: process.env.DATABASE_NAME || "filecoin_dealbot",
    },
    blockchain: {
      network: (process.env.NETWORK || "calibration") as Network,
      walletAddress: process.env.WALLET_ADDRESS || "0x0000000000000000000000000000000000000000",
      walletPrivateKey: process.env.WALLET_PRIVATE_KEY || "",
      checkDatasetCreationFees: process.env.CHECK_DATASET_CREATION_FEES !== "false",
      useOnlyApprovedProviders: process.env.USE_ONLY_APPROVED_PROVIDERS !== "false",
      enableCDNTesting: process.env.ENABLE_CDN_TESTING !== "false",
      enableIpniTesting: parseIpniTestingMode(process.env.ENABLE_IPNI_TESTING),
      dealbotDataSetVersion: process.env.DEALBOT_DATASET_VERSION,
    },
    scheduling: {
      dealIntervalSeconds: Number.parseInt(process.env.DEAL_INTERVAL_SECONDS || "30", 10),
      retrievalIntervalSeconds: Number.parseInt(process.env.RETRIEVAL_INTERVAL_SECONDS || "60", 10),
      dealStartOffsetSeconds: Number.parseInt(process.env.DEAL_START_OFFSET_SECONDS || "0", 10),
      retrievalStartOffsetSeconds: Number.parseInt(process.env.RETRIEVAL_START_OFFSET_SECONDS || "600", 10),
      metricsStartOffsetSeconds: Number.parseInt(process.env.METRICS_START_OFFSET_SECONDS || "900", 10),
    },
    dataset: {
      localDatasetsPath: process.env.DEALBOT_LOCAL_DATASETS_PATH || DEFAULT_LOCAL_DATASETS_PATH,
      totalPages: Number.parseInt(process.env.KAGGLE_DATASET_TOTAL_PAGES || "500", 10),
      randomDatasetSizes: (() => {
        const envValue = process.env.RANDOM_DATASET_SIZES;
        if (envValue && envValue.trim().length > 0) {
          const parsed = envValue
            .split(",")
            .map((s) => Number.parseInt(s.trim(), 10))
            .filter((n) => Number.isFinite(n) && !Number.isNaN(n));
          if (parsed.length > 0) {
            return parsed;
          }
        }
        return [
          10 << 10, // 10 KiB
          10 << 20, // 10 MB
          100 << 20, // 100 MB
        ];
      })(),
    },
    proxy: {
      list: process.env.PROXY_LIST?.split(",") || [],
      locations: process.env.PROXY_LOCATIONS?.split(",") || [],
    },
    filBeam: {
      botToken: process.env.FILBEAM_BOT_TOKEN || "",
    },
    timeouts: {
      connectTimeoutMs: Number.parseInt(process.env.CONNECT_TIMEOUT_MS || "10000", 10),
      httpRequestTimeoutMs: Number.parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS || "600000", 10),
      http2RequestTimeoutMs: Number.parseInt(process.env.HTTP2_REQUEST_TIMEOUT_MS || "600000", 10),
      retrievalTimeoutBufferMs: Number.parseInt(process.env.RETRIEVAL_TIMEOUT_BUFFER_MS || "60000", 10),
    },
  };
}
