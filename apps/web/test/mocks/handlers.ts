import { http, HttpResponse } from "msw";

export const handlers = [
  // Mock Metrics handlers would come here
  http.get("/api/test", () => {
    return HttpResponse.json({
      message: "Hello from MSW!",
      status: "success",
    });
  }),
];
