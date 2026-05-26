export type Network = "mainnet" | "calibration";

export interface NetworkConfig {
  network: Network;
  dealsPerSpPerHour: number;
  retrievalsPerSpPerHour: number;
  dataSetCreationsPerSpPerHour: number;
  pullChecksPerSpPerHour: number;
  dataRetentionPollIntervalSeconds: number;
  providersRefreshIntervalSeconds: number;
}

export interface AppConfigResponse {
  networks: NetworkConfig[];
}
