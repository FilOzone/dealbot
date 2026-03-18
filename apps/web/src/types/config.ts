export interface DealbotConfigDto {
  network: "mainnet" | "calibration";
  jobs: {
    dealsPerSpPerHour: number;
    dataSetCreationsPerSpPerHour: number;
    retrievalsPerSpPerHour: number;
  };
}
