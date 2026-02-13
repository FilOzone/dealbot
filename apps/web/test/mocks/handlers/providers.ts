import { HttpResponse, http } from "msw";
import { mockProviderData } from "../data/providers";
import { wait } from "../utils/wait";

export const providersHandler = http.get("/api/providers", async ({ request }) => {
  const url = new URL(request.url);
  const preset = url.searchParams.get("preset");
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");

  // wait for 1 seconds
  await wait(1_000);

  return HttpResponse.json({
    data: mockProviderData,
    meta: {
      preset,
      startDate,
      endDate,
      count: mockProviderData.length,
    },
  });
});
