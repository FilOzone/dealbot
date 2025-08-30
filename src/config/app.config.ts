import Joi from "joi";
import { Network } from "../common/types.js";
import { DEFAULT_LOCAL_DATASETS_PATH } from "../common/constants.js";

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

  // Scheduling
  DEAL_INTERVAL_SECONDS: Joi.number().default(30),
  RETRIEVAL_INTERVAL_SECONDS: Joi.number().default(60),

  // Kaggle
  DEALBOT_LOCAL_DATASETS_PATH: Joi.string().default(DEFAULT_LOCAL_DATASETS_PATH),
  KAGGLE_DATASET_TOTAL_PAGES: Joi.number().default(500),
});

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
}

export interface ISchedulingConfig {
  dealIntervalSeconds: number;
  retrievalIntervalSeconds: number;
}

export interface IDatasetConfig {
  totalPages: number;
  localDatasetsPath: string;
}

export interface IConfig {
  app: IAppConfig;
  database: IDatabaseConfig;
  blockchain: IBlockchainConfig;
  scheduling: ISchedulingConfig;
  dataset: IDatasetConfig;
}

export function loadConfig(): IConfig {
  return {
    app: {
      env: process.env.NODE_ENV || "development",
      port: parseInt(process.env.DEALBOT_PORT || "3000", 10),
      host: process.env.DEALBOT_HOST || "127.0.0.1",
    },
    database: {
      host: process.env.DATABASE_HOST || "localhost",
      port: parseInt(process.env.DATABASE_PORT || "5432", 10),
      username: process.env.DATABASE_USER || "dealbot",
      password: process.env.DATABASE_PASSWORD || "dealbot_password",
      database: process.env.DATABASE_NAME || "filecoin_dealbot",
    },
    blockchain: {
      network: (process.env.NETWORK || "calibration") as Network,
      walletAddress: process.env.WALLET_ADDRESS || "0x0000000000000000000000000000000000000000",
      walletPrivateKey: process.env.WALLET_PRIVATE_KEY || "",
    },
    scheduling: {
      dealIntervalSeconds: parseInt(process.env.DEAL_INTERVAL_SECONDS || "30", 10),
      retrievalIntervalSeconds: parseInt(process.env.RETRIEVAL_INTERVAL_SECONDS || "60", 10),
    },
    dataset: {
      localDatasetsPath: process.env.DEALBOT_LOCAL_DATASETS_PATH || DEFAULT_LOCAL_DATASETS_PATH,
      totalPages: parseInt(process.env.KAGGLE_DATASET_TOTAL_PAGES || "500", 10),
    },
  };
}
