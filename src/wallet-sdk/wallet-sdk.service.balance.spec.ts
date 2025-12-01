import { WalletSdkService } from "./wallet-sdk.service.js";

// Minimal mock for ESM SDK to allow TS file import without loading real package
jest.mock("@filoz/synapse-sdk", () => ({
  CONTRACT_ADDRESSES: {
    WARM_STORAGE: { calibration: "0xwarm" },
    PAYMENTS: { calibration: "0xpayments" },
  },
}), { virtual: true });

jest.mock("@filoz/synapse-sdk/sp-registry", () => ({
  SPRegistryService: class {},
}), { virtual: true });

describe("WalletSdkService balance monitoring", () => {
  const makeService = (opts: {
    availableFunds: bigint;
    filBalance?: bigint;
    alertOnly?: boolean;
    autoFundEnabled?: boolean;
    autoFundAmount?: bigint;
    threshold?: bigint;
  }) => {
    const cfg: any = {
      get: (key: string) => {
        if (key === "blockchain") {
          return { network: "calibration" };
        }
        if (key === "walletMonitor") {
          return {
            balanceCheckIntervalSeconds: 60,
            balanceThresholdUsdfc: String(opts.threshold ?? 1000n),
            autoFundAmountUsdfc: String(opts.autoFundAmount ?? 500n),
            autoFundEnabled: opts.autoFundEnabled ?? false,
            alertOnlyMode: opts.alertOnly ?? true,
            cooldownMinutes: 30,
          };
        }
        return undefined;
      },
    };

    const repo: any = {};
    const alerts = {
      sendLowBalanceAlert: jest.fn(async () => {}),
      sendFundResultAlert: jest.fn(async () => {}),
    } as any;

    const svc = new WalletSdkService(cfg, repo, alerts) as any;
    svc["paymentsService"] = {
      balance: jest.fn(async () => opts.availableFunds),
      walletBalance: jest.fn(async () => (opts.filBalance ?? 1n)),
      allowance: jest.fn(async () => 0n),
      deposit: jest.fn(async () => ({ hash: "0xhash", wait: async () => ({ transactionHash: "0xhash" }) })),
    };
    svc["paymentsAddress"] = "0xpayments";

    return { svc, alerts };
  };

  it("alerts on low balance in alert-only mode and enforces cooldown", async () => {
    const { svc, alerts } = makeService({ availableFunds: 10n, threshold: 100n, alertOnly: true });
    await svc.checkAndHandleBalance();
    expect(alerts.sendLowBalanceAlert).toHaveBeenCalledTimes(1);

    // Second call within cooldown should skip
    await svc.checkAndHandleBalance();
    expect(alerts.sendLowBalanceAlert).toHaveBeenCalledTimes(1);
  });

  it("alerts when no FIL gas prevents auto-fund", async () => {
    const { svc, alerts } = makeService({
      availableFunds: 10n,
      threshold: 100n,
      alertOnly: false,
      autoFundEnabled: true,
      autoFundAmount: 50n,
      filBalance: 0n,
    });
    await svc.checkAndHandleBalance();
    expect(alerts.sendLowBalanceAlert).toHaveBeenCalledTimes(1);
  });

  it("executes deposit and alerts success when auto-fund enabled and conditions met", async () => {
    const fundAmount = 500n;
    const { svc, alerts } = makeService({
      availableFunds: 10n, // Below threshold
      threshold: 1000n,
      autoFundAmount: fundAmount,
      autoFundEnabled: true,
      alertOnly: false,
      filBalance: 1000000000000000000n, // Sufficient gas (1 FIL)
    });

    await svc.checkAndHandleBalance();

    // Verify deposit was called with correct amount
    expect(svc["paymentsService"].deposit).toHaveBeenCalledTimes(1);
    expect(svc["paymentsService"].deposit).toHaveBeenCalledWith(
      fundAmount,
      undefined,
      expect.any(Object), // callbacks
    );

    // Verify success alert was sent
    expect(alerts.sendFundResultAlert).toHaveBeenCalledTimes(1);
    expect(alerts.sendFundResultAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        depositAmount: fundAmount.toString(),
      }),
    );
  });

  it("alerts failure when deposit transaction throws error", async () => {
    const { svc, alerts } = makeService({
      availableFunds: 10n,
      threshold: 100n,
      autoFundEnabled: true,
      alertOnly: false,
      filBalance: 1000000000000000000n, // Sufficient gas
    });

    // Mock deposit failure
    svc["paymentsService"].deposit.mockRejectedValueOnce(new Error("Insufficient funds"));

    await svc.checkAndHandleBalance();

    expect(alerts.sendFundResultAlert).toHaveBeenCalledTimes(1);
    expect(alerts.sendFundResultAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("Insufficient funds"),
      }),
    );
  });
});
