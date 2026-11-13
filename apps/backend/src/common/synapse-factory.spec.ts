import { beforeEach, describe, expect, it, vi } from "vitest";
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
};

describe("createSynapseFromConfig", () => {
  beforeEach(() => {
    synapseCreate.mockReset();
    synapseConstruct.mockReset();
  });

  // Batching reuses a terminated data set's ID when its slot is recreated.
  it("disables SDK piece batching with a wallet key", async () => {
    await createSynapseFromConfig({ ...baseNetworkConfig, walletPrivateKey: privateKey });
    expect(synapseCreate).toHaveBeenCalledWith(expect.objectContaining({ pieceBatching: false }));
  });

  it("disables SDK piece batching with a session key", async () => {
    await createSynapseFromConfig({ ...baseNetworkConfig, sessionKeyPrivateKey: privateKey });
    expect(synapseConstruct).toHaveBeenCalledWith(expect.objectContaining({ pieceBatching: false }));
  });
});
