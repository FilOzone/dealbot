import * as Joi from "joi";

export const configValidationSchema = Joi.object({
  // Application
  NODE_ENV: Joi.string().valid("development", "production", "test").default("development"),
  DEALBOT_PORT: Joi.number().default(3000),
  DEALBOT_HOST: Joi.string().default("127.0.0.1"),

  // Dealbot
  DEALBOT_LOCAL_DATASETS_PATH: Joi.string().default("./datasets"),

  // Database
  DATABASE_HOST: Joi.string().required(),
  DATABASE_PORT: Joi.number().default(5432),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_NAME: Joi.string().required(),

  // Blockchain
  WALLET_ADDRESS: Joi.string().required(),
  WALLET_PRIVATE_KEY: Joi.string().required(),

  // Scheduling
  DEAL_INTERVAL_SECONDS: Joi.number().default(30),
  RETRIEVAL_INTERVAL_SECONDS: Joi.number().default(60),
});

export interface IAppConfig {
  app: {
    env: string;
    port: number;
    host: string;
  };
  dealbot: {
    localDatasetsPath: string;
  };
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
  };
  blockchain: {
    walletAddress: string;
    walletPrivateKey: string;
  };
  scheduling: {
    dealIntervalSeconds: number;
    retrievalIntervalSeconds: number;
  };
}

export function loadConfig(): IAppConfig {
  return {
    app: {
      env: process.env.NODE_ENV || "development",
      port: parseInt(process.env.DEALBOT_PORT || "3000", 10),
      host: process.env.DEALBOT_HOST || "127.0.0.1",
    },
    dealbot: {
      localDatasetsPath: process.env.DEALBOT_LOCAL_DATASETS_PATH || "./datasets",
    },
    database: {
      host: process.env.DATABASE_HOST || "localhost",
      port: parseInt(process.env.DATABASE_PORT || "5432", 10),
      username: process.env.DATABASE_USER || "dealbot",
      password: process.env.DATABASE_PASSWORD || "dealbot_password",
      database: process.env.DATABASE_NAME || "filecoin_dealbot",
    },
    blockchain: {
      walletAddress: process.env.WALLET_ADDRESS || "0x0000000000000000000000000000000000000000",
      walletPrivateKey: process.env.WALLET_PRIVATE_KEY || "",
    },
    scheduling: {
      dealIntervalSeconds: parseInt(process.env.DEAL_INTERVAL_SECONDS || "30", 10),
      retrievalIntervalSeconds: parseInt(process.env.RETRIEVAL_INTERVAL_SECONDS || "60", 10),
    },
  };
}
