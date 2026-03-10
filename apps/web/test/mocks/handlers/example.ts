import { HttpResponse, http } from "msw";

export const exampleHandler = http.get("/api/test", () => {
  return HttpResponse.json({
    message: "Hello from MSW!",
    status: "success",
  });
});
