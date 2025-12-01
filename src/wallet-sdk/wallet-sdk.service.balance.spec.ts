import type { IDepositCallbacks } from "./wallet-sdk.service.js";
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

describe("WalletSdkService - IDepositCallbacks", () => {
  const makeService = (depositMock: jest.Mock) => {
    const cfg: any = {
      get: (key: string) => {
        if (key === "blockchain") {
          return { network: "calibration" };
        }
        if (key === "walletMonitor") {
          return {
            balanceCheckIntervalSeconds: 60,
            balanceThresholdUsdfc: "1000",
            autoFundAmountUsdfc: "500",
            autoFundEnabled: true,
            alertOnlyMode: false,
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
      balance: jest.fn(async () => 10n), // Below threshold
      walletBalance: jest.fn(async () => 1000000000000000000n), // Sufficient gas
      allowance: jest.fn(async () => 0n),
      deposit: depositMock,
    };
    svc["paymentsAddress"] = "0xpayments";

    return { svc, alerts };
  };

  it("should pass properly typed callbacks to deposit method", async () => {
    const depositMock = jest.fn(async () => ({ 
      hash: "0xhash123", 
      wait: async () => ({ hash: "0xhash123" }) 
    }));

    const { svc } = makeService(depositMock);

    await svc.checkAndHandleBalance();

    expect(depositMock).toHaveBeenCalledTimes(1);
    expect(depositMock).toHaveBeenCalledWith(
      500n, // autoFundAmount
      undefined,
      expect.objectContaining({
        onAllowanceCheck: expect.any(Function),
        onApprovalTransaction: expect.any(Function),
        onApprovalConfirmed: expect.any(Function),
        onDepositStarting: expect.any(Function),
      })
    );
  });

  it("should invoke onAllowanceCheck callback with bigint parameter", async () => {
    const mockAllowance = 1000000n;
    const onAllowanceCheckSpy = jest.fn();

    const depositMock = jest.fn(async (_amount, _recipient, callbacks: IDepositCallbacks) => {
      // Simulate SDK calling the callback
      callbacks.onAllowanceCheck?.(mockAllowance);
      return { 
        hash: "0xhash123", 
        wait: async () => ({ hash: "0xhash123" }) 
      };
    });

    const { svc } = makeService(depositMock);

    // Override logger.log to capture callback invocation
    const logSpy = jest.spyOn(svc["logger"], "log");

    await svc.checkAndHandleBalance();

    expect(logSpy).toHaveBeenCalledWith(
      "Allowance checked",
      { allowance: mockAllowance.toString() }
    );
  });

  it("should invoke onApprovalTransaction callback with transaction hash", async () => {
    const mockTxHash = "0xapproval456";
    
    const depositMock = jest.fn(async (_amount, _recipient, callbacks: IDepositCallbacks) => {
      // Simulate SDK calling the callback
      callbacks.onApprovalTransaction?.({ hash: mockTxHash });
      return { 
        hash: "0xdeposit789", 
        wait: async () => ({ hash: "0xdeposit789" }) 
      };
    });

    const { svc } = makeService(depositMock);
    const logSpy = jest.spyOn(svc["logger"], "log");

    await svc.checkAndHandleBalance();

    expect(logSpy).toHaveBeenCalledWith(
      "Approval tx submitted",
      { hash: mockTxHash }
    );
  });

  it("should invoke onApprovalConfirmed callback with receipt", async () => {
    const mockReceiptHash = "0xreceipt789";
    
    const depositMock = jest.fn(async (_amount, _recipient, callbacks: IDepositCallbacks) => {
      // Simulate SDK calling the callback
      callbacks.onApprovalConfirmed?.({ hash: mockReceiptHash });
      return { 
        hash: "0xdeposit123", 
        wait: async () => ({ hash: "0xdeposit123" }) 
      };
    });

    const { svc } = makeService(depositMock);
    const logSpy = jest.spyOn(svc["logger"], "log");

    await svc.checkAndHandleBalance();

    expect(logSpy).toHaveBeenCalledWith(
      "Approval confirmed",
      { txHash: mockReceiptHash }
    );
  });

  it("should invoke onDepositStarting callback before deposit", async () => {
    const autoFundAmount = 500n;
    
    const depositMock = jest.fn(async (_amount, _recipient, callbacks: IDepositCallbacks) => {
      // Simulate SDK calling the callback
      callbacks.onDepositStarting?.();
      return { 
        hash: "0xdeposit999", 
        wait: async () => ({ hash: "0xdeposit999" }) 
      };
    });

    const { svc } = makeService(depositMock);
    const logSpy = jest.spyOn(svc["logger"], "log");

    await svc.checkAndHandleBalance();

    expect(logSpy).toHaveBeenCalledWith(
      "Deposit starting",
      { amount: autoFundAmount.toString() }
    );
  });

  it("should handle all callbacks in sequence during successful deposit", async () => {
    const callbackSequence: string[] = [];
    
    const depositMock = jest.fn(async (_amount, _recipient, callbacks: IDepositCallbacks) => {
      // Simulate SDK calling all callbacks in sequence
      callbackSequence.push("start");
      callbacks.onAllowanceCheck?.(5000n);
      callbackSequence.push("allowance");
      callbacks.onApprovalTransaction?.({ hash: "0xapproval" });
      callbackSequence.push("approval-tx");
      callbacks.onApprovalConfirmed?.({ hash: "0xapproval-receipt" });
      callbackSequence.push("approval-confirmed");
      callbacks.onDepositStarting?.();
      callbackSequence.push("deposit-starting");
      
      return { 
        hash: "0xfinal", 
        wait: async () => ({ hash: "0xfinal" }) 
      };
    });

    const { svc } = makeService(depositMock);
    const logSpy = jest.spyOn(svc["logger"], "log");

    await svc.checkAndHandleBalance();

    // Verify all callbacks were invoked in sequence
    expect(callbackSequence).toEqual([
      "start",
      "allowance",
      "approval-tx",
      "approval-confirmed",
      "deposit-starting"
    ]);

    // Verify logger was called for each callback
    expect(logSpy).toHaveBeenCalledWith("Allowance checked", expect.any(Object));
    expect(logSpy).toHaveBeenCalledWith("Approval tx submitted", expect.any(Object));
    expect(logSpy).toHaveBeenCalledWith("Approval confirmed", expect.any(Object));
    expect(logSpy).toHaveBeenCalledWith("Deposit starting", expect.any(Object));
  });

  it("should handle optional callbacks gracefully when not provided", async () => {
    // Test that deposit works even if SDK doesn't call all callbacks
    const depositMock = jest.fn(async (_amount, _recipient, callbacks: IDepositCallbacks) => {
      // Only call some callbacks
      callbacks.onAllowanceCheck?.(1000n);
      // Skip others intentionally
      return { 
        hash: "0xpartial", 
        wait: async () => ({ hash: "0xpartial" }) 
      };
    });

    const { svc } = makeService(depositMock);

    // Should not throw
    await expect(svc.checkAndHandleBalance()).resolves.not.toThrow();
  });

  it("should maintain type safety with IDepositCallbacks interface", () => {
    // Compile-time type check - this test verifies the interface structure
    const validCallbacks: IDepositCallbacks = {
      onAllowanceCheck: (allowance: bigint) => {
        expect(typeof allowance).toBe("bigint");
      },
      onApprovalTransaction: (tx: { hash: string }) => {
        expect(typeof tx.hash).toBe("string");
      },
      onApprovalConfirmed: (receipt: { hash?: string }) => {
        expect(typeof receipt.hash === "string" || receipt.hash === undefined).toBe(true);
      },
      onDepositStarting: () => {
        // No parameters
      },
    };

    // Verify all properties are optional
    const emptyCallbacks: IDepositCallbacks = {};
    expect(emptyCallbacks).toBeDefined();
    
    // Verify partial callbacks are valid
    const partialCallbacks: IDepositCallbacks = {
      onAllowanceCheck: (_allowance: bigint) => {},
    };
    expect(partialCallbacks).toBeDefined();
  });
});

