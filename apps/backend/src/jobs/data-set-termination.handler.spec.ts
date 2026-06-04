import { describe, expect, it, vi } from "vitest";
import type { ProviderJobContext } from "../common/logging.js";
import { terminateNextDataSet } from "./data-set-termination.handler.js";

const logContext: ProviderJobContext = {
  jobId: "job-term",
  providerAddress: "0xaaa",
  providerId: 1n,
  providerName: "sp",
};

const makeLogger = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as any;

const POLL_TIMEOUT_MS = 60_000;

describe("terminateNextDataSet", () => {
  it("terminates a live slot in the canary window and stops", async () => {
    const dealService = {
      getDataSetProvisioningStatus: vi.fn(async () => ({ status: "live" as const, dataSetId: 42n })),
      terminateManagedDataSet: vi.fn(async () => ({ dealsAffected: 2, pdpEndEpoch: 10n })),
      recordDataSetTerminationSkipped: vi.fn(),
    };

    // window [1, 2): only slot index 1 is eligible
    await terminateNextDataSet({ dealService, logger: makeLogger() }, "0xaaa", 2, 1, {}, logContext, POLL_TIMEOUT_MS);

    expect(dealService.getDataSetProvisioningStatus).toHaveBeenCalledWith("0xaaa", { dealbotDS: "1" }, undefined);
    expect(dealService.terminateManagedDataSet).toHaveBeenCalledWith("0xaaa", 42n, undefined, POLL_TIMEOUT_MS);
    expect(dealService.recordDataSetTerminationSkipped).not.toHaveBeenCalled();
  });

  it("skips missing slots and terminates the live/terminated one regardless of scan order", async () => {
    // window [1, 3): index 1 is missing, index 2 is terminated -> index 2 must be the one terminated
    const dealService = {
      getDataSetProvisioningStatus: vi.fn(async (_sp: string, metadata: Record<string, string>) => {
        if (metadata.dealbotDS === "2") {
          return { status: "terminated" as const, dataSetId: 99n };
        }
        return { status: "missing" as const };
      }),
      terminateManagedDataSet: vi.fn(async () => ({ dealsAffected: 0, pdpEndEpoch: 5n })),
      recordDataSetTerminationSkipped: vi.fn(),
    };

    await terminateNextDataSet({ dealService, logger: makeLogger() }, "0xaaa", 3, 1, {}, logContext, POLL_TIMEOUT_MS);

    expect(dealService.terminateManagedDataSet).toHaveBeenCalledTimes(1);
    expect(dealService.terminateManagedDataSet).toHaveBeenCalledWith("0xaaa", 99n, undefined, POLL_TIMEOUT_MS);
    expect(dealService.recordDataSetTerminationSkipped).not.toHaveBeenCalled();
  });

  it("records skipped.no_candidate when every candidate slot is missing", async () => {
    const dealService = {
      getDataSetProvisioningStatus: vi.fn(async () => ({ status: "missing" as const })),
      terminateManagedDataSet: vi.fn(),
      recordDataSetTerminationSkipped: vi.fn(),
    };

    await terminateNextDataSet({ dealService, logger: makeLogger() }, "0xaaa", 4, 1, {}, logContext, POLL_TIMEOUT_MS);

    expect(dealService.terminateManagedDataSet).not.toHaveBeenCalled();
    expect(dealService.recordDataSetTerminationSkipped).toHaveBeenCalledWith("0xaaa");
    // All three candidate slots (1,2,3) were probed.
    expect(dealService.getDataSetProvisioningStatus).toHaveBeenCalledTimes(3);
  });

  it("never probes slots below minIndex", async () => {
    const probed: Array<string | undefined> = [];
    const dealService = {
      getDataSetProvisioningStatus: vi.fn(async (_sp: string, metadata: Record<string, string>) => {
        probed.push(metadata.dealbotDS);
        return { status: "missing" as const };
      }),
      terminateManagedDataSet: vi.fn(),
      recordDataSetTerminationSkipped: vi.fn(),
    };

    // window [3, 5): only slots 3 and 4 are eligible; 0,1,2 are protected
    await terminateNextDataSet({ dealService, logger: makeLogger() }, "0xaaa", 5, 3, {}, logContext, POLL_TIMEOUT_MS);

    expect(probed.sort()).toEqual(["3", "4"]);
  });

  it("never probes the baseline slot 0 even if minIndex is misconfigured below 1", async () => {
    const probed: Array<string | undefined> = [];
    const dealService = {
      getDataSetProvisioningStatus: vi.fn(async (_sp: string, metadata: Record<string, string>) => {
        probed.push(metadata.dealbotDS);
        return { status: "missing" as const };
      }),
      terminateManagedDataSet: vi.fn(),
      recordDataSetTerminationSkipped: vi.fn(),
    };

    // minIndex=0 should be clamped to 1; slot 0 (no dealbotDS tag) must never be probed
    await terminateNextDataSet({ dealService, logger: makeLogger() }, "0xaaa", 3, 0, {}, logContext, POLL_TIMEOUT_MS);

    expect(probed.sort()).toEqual(["1", "2"]);
    expect(probed).not.toContain(undefined);
  });

  it("merges base dataset metadata into each slot's lookup", async () => {
    const dealService = {
      getDataSetProvisioningStatus: vi.fn(async () => ({ status: "live" as const, dataSetId: 1n })),
      terminateManagedDataSet: vi.fn(async () => ({ dealsAffected: 0, pdpEndEpoch: 1n })),
      recordDataSetTerminationSkipped: vi.fn(),
    };

    await terminateNextDataSet(
      { dealService, logger: makeLogger() },
      "0xaaa",
      2,
      1,
      { withIPFSIndexing: "", dealbotDataSetVersion: "v1" },
      logContext,
      POLL_TIMEOUT_MS,
    );

    expect(dealService.getDataSetProvisioningStatus).toHaveBeenCalledWith(
      "0xaaa",
      { withIPFSIndexing: "", dealbotDataSetVersion: "v1", dealbotDS: "1" },
      undefined,
    );
  });

  it("stops immediately and does not terminate when the signal is already aborted", async () => {
    const dealService = {
      getDataSetProvisioningStatus: vi.fn(async () => ({ status: "live" as const, dataSetId: 1n })),
      terminateManagedDataSet: vi.fn(),
      recordDataSetTerminationSkipped: vi.fn(),
    };

    const controller = new AbortController();
    controller.abort(new Error("Job timed out"));

    await expect(
      terminateNextDataSet(
        { dealService, logger: makeLogger() },
        "0xaaa",
        2,
        1,
        {},
        logContext,
        POLL_TIMEOUT_MS,
        controller.signal,
      ),
    ).rejects.toThrow("Job timed out");

    expect(dealService.terminateManagedDataSet).not.toHaveBeenCalled();
    expect(dealService.recordDataSetTerminationSkipped).not.toHaveBeenCalled();
  });
});
