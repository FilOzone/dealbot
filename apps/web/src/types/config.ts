export interface DealbotConfigDto {
  network: "mainnet" | "calibration";
  scheduling: {
    dealIntervalSeconds: number;
    retrievalIntervalSeconds: number;
  };
}
