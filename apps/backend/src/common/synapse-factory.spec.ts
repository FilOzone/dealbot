import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IConfig } from "../config/index.js";
import { createSynapseFromConfig } from "./synapse-factory.js";

const { synapseCreate, synapseConstruct } = vi.hoisted(() => ({
  synapseCreate: vi.fn(),
  synapseConstruct: vi.fn(),
}));

vi.mock("@filoz/synapse-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@filoz/synapse-sdk")>();
  class Synapse {
    static create = synapseCreate;
    constructor(options: unknown) {
      synapseConstruct(options);
    }
  }
  return { ...actual, Synapse };
});

vi.mock("@filoz/synapse-core/session-key", () => ({
  DefaultFwssPermissions: [],
  fromSecp256k1: () => ({
    syncExpirations: vi.fn().mockResolvedValue(undefined),
    hasPermissions: () => true,
    client: {},
  }),
}));

const privateKey = "0x0123456789012345678901234567890123456789012345678901234567890123";

const baseNetworkConfig = {
  network: "calibration" as const,
  rpcRequestTimeoutMs: 30000,
  walletAddress: "0x0000000000000000000000000000000000000001",
  checkDatasetCreationFees: false,
  useOnlyApprovedProviders: false,
  minNumDataSetsForChecks: 1,
  pdpSubgraphEndpoint: "https://api.thegraph.com/subgraphs/filecoin/pdp",
  dealsPerSpPerHour: 4,
  retrievalsPerSpPerHour: 2,
  sampledRetrievalsPerSpPerHour: 2,
  dataSetCreationsPerSpPerHour: 1,
  dataSetLifecycleCheckEnabled: true,
  dataSetLifecycleChecksPerSpPerHour: 1,
  dataSetLifecycleCheckJobTimeoutSeconds: 600,
  dataRetentionPollIntervalSeconds: 3600,
  providersRefreshIntervalSeconds: 14400,
  dataSetPruningIntervalSeconds: 86400,
  abandonedDataSetSweepIntervalSeconds: 86400,
  excessDataSetBuffer: 5,
  spCleanupJobTimeoutSeconds: 1200,
  maintenanceWindowsUtc: [],
  maintenanceWindowMinutes: 20,
  pieceCleanupPerSpPerHour: 1,
  maxPieceCleanupRuntimeSeconds: 300,
  maxDatasetStorageSizeBytes: 24 * 1024 * 1024 * 1024,
  targetDatasetStorageSizeBytes: 20 * 1024 * 1024 * 1024,
  blockedSpIds: new Set<string>(),
  blockedSpAddresses: new Set<string>(),
  fullRateSpIds: new Set<string>(),
  fullRateSpAddresses: new Set<string>(),
  dealJobTimeoutSeconds: 300,
  dataSetCreationJobTimeoutSeconds: 300,
  retrievalJobTimeoutSeconds: 300,
  sampledRetrievalJobTimeoutSeconds: 360,
  pullChecksPerSpPerHour: 1,
  pullCheckJobTimeoutSeconds: 300,
  pullCheckPollIntervalSeconds: 2,
  pullCheckPieceSizeBytes: 10 * 1024 * 1024,
  pullPieceCleanupIntervalSeconds: 7 * 24 * 3600,
};

describe("createSynapseFromConfig", () => {
  beforeEach(() => {
    synapseCreate.mockReset();
    synapseConstruct.mockReset();
  });

  // Batching reuses a terminated data set's ID when its slot is recreated.
  it("disables SDK piece batching with a wallet key", async () => {
    const config = { ...baseNetworkConfig, walletPrivateKey: privateKey } satisfies IConfig["networks"]["calibration"];
    await createSynapseFromConfig(config);
    expect(synapseCreate).toHaveBeenCalledWith(expect.objectContaining({ pieceBatching: false }));
  });

  it("disables SDK piece batching with a session key", async () => {
    const config = {
      ...baseNetworkConfig,
      sessionKeyPrivateKey: privateKey,
    } satisfies IConfig["networks"]["calibration"];
    await createSynapseFromConfig(config);
    expect(synapseConstruct).toHaveBeenCalledWith(expect.objectContaining({ pieceBatching: false }));
  });
});
