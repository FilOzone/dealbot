import { HttpResponse, http } from "msw";

export const configHandler = http.get("/api/config", () => {
  return HttpResponse.json({
    networks: [
      {
        network: "mainnet",
        dealsPerSpPerHour: 4,
        retrievalsPerSpPerHour: 4,
        dataSetCreationsPerSpPerHour: 0,
        pullChecksPerSpPerHour: 0,
        dataRetentionPollIntervalSeconds: 3600,
        providersRefreshIntervalSeconds: 3600,
      },
    ],
  });
});
