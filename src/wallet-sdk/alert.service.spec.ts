import { AlertService } from "./alert.service.js";

describe("AlertService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const makeService = (postImpl: (url: string, body: any) => Promise<any>) => {
    const httpClient: any = {
      postJson: jest.fn((url: string, body: any) => postImpl(url, body)),
    };

    // Mock ConfigService
    const configService: any = {
      get: jest.fn((key) => {
        if (key === "alerts") {
          return { webhookUrl: process.env.ALERT_WEBHOOK_URL || "" };
        }
        return undefined;
      }),
    };

    const svc = new AlertService(httpClient, configService);
    return { svc, httpClient };
  };

  it("skips alert when webhook URL missing", async () => {
    process.env.ALERT_WEBHOOK_URL = "";
    const { svc, httpClient } = makeService(async () => Promise.resolve());

    await svc.sendLowBalanceAlert({ balance: "10" });

    expect(httpClient.postJson).not.toHaveBeenCalled();
  });

  it("sends alert when webhook URL set (single call)", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://example.com/webhook";
    const { svc, httpClient } = makeService(async () => Promise.resolve());

    await svc.sendFundResultAlert({ amount: "1000" });

    expect(httpClient.postJson).toHaveBeenCalledTimes(1);
    expect(httpClient.postJson).toHaveBeenCalledWith(
      "https://example.com/webhook",
      expect.objectContaining({ type: "auto_fund_result" }),
    );
  });

  it("retries once on failure", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://example.com/webhook";
    const failOnce = jest
      .fn()
      .mockRejectedValueOnce(new Error("net"))
      .mockRejectedValueOnce(new Error("still failing"));

    const { svc, httpClient } = makeService(async (u, b) => failOnce(u, b));

    await expect(svc.sendLowBalanceAlert({ balance: "1" })).resolves.toBeUndefined();

    expect(httpClient.postJson).toHaveBeenCalledTimes(2);
  });
});
