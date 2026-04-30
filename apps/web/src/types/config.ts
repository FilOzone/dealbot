export type Network = "mainnet" | "calibration";

export interface AppConfigResponse {
  network: Network;
  jobs: {
    dealsPerSpPerHour?: number;
    dataSetCreationsPerSpPerHour?: number;
    retrievalsPerSpPerHour?: number;
  };
}
