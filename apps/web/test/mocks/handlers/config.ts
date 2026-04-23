import { HttpResponse, http } from "msw";

export const configHandler = http.get("/api/config", () => {
  return HttpResponse.json({
    network: "mainnet",
  });
});
