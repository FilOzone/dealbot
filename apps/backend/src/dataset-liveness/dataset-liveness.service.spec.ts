import { Test, TestingModule } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalletSdkService } from "../wallet-sdk/wallet-sdk.service.js";
import { DatasetLivenessService } from "./dataset-liveness.service.js";

vi.mock("@filoz/synapse-core/pdp-verifier", () => ({}));

vi.mock("@filoz/synapse-core/chains", () => ({
  asChain: () => ({
    contracts: {
      pdp: {
        address: "0xpdp",
        abi: [],
      },
    },
  }),
}));

const readContractMock = vi.fn();
vi.mock("viem/actions", () => ({
  readContract: (...args: unknown[]) => readContractMock(...args),
}));

describe("DatasetLivenessService", () => {
  let service: DatasetLivenessService;
  let fetchMock: ReturnType<typeof vi.fn>;

  const mockWarmStorageService = {
    validateDataSet: vi.fn().mockResolvedValue(undefined),
  };
  const mockWalletSdkService = {
    getProviderInfo: vi.fn().mockReturnValue({
      id: 101n,
      pdp: { serviceURL: "https://sp.example" },
    }),
    getWalletServices: vi.fn().mockReturnValue({
      warmStorageService: mockWarmStorageService,
    }),
    getSynapseClient: vi.fn().mockReturnValue({ chain: { id: 314 } }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DatasetLivenessService, { provide: WalletSdkService, useValue: mockWalletSdkService }],
    }).compile();
    service = module.get<DatasetLivenessService>(DatasetLivenessService);
    fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mockWarmStorageService.validateDataSet.mockReset().mockResolvedValue(undefined);
    readContractMock.mockReset();
  });

  describe("isDataSetLive", () => {
    it("returns true when both probes report live", async () => {
      await expect(service.isDataSetLive("0xprovider", 1n)).resolves.toBe(true);
    });

    it("returns false when FWSS validateDataSet reports not live", async () => {
      mockWarmStorageService.validateDataSet.mockRejectedValueOnce(
        new Error("Data set 1 does not exist or is not live"),
      );
      await expect(service.isDataSetLive("0xprovider", 1n)).resolves.toBe(false);
    });

    it("returns false when SP HTTP probe returns 409 with the terminated body", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("Data set has been terminated due to unrecoverable proving failure", { status: 409 }),
      );
      await expect(service.isDataSetLive("0xprovider", 1n)).resolves.toBe(false);
    });

    it("treats SP HTTP 409 with a different body as live", async () => {
      fetchMock.mockResolvedValueOnce(new Response("piece already exists", { status: 409 }));
      await expect(service.isDataSetLive("0xprovider", 1n)).resolves.toBe(true);
    });

    it("treats SP HTTP non-409 responses as live", async () => {
      fetchMock.mockResolvedValueOnce(new Response("At least one piece must be provided", { status: 400 }));
      await expect(service.isDataSetLive("0xprovider", 1n)).resolves.toBe(true);
    });

    it("treats SP HTTP network errors as live", async () => {
      fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      await expect(service.isDataSetLive("0xprovider", 1n)).resolves.toBe(true);
    });

    it("rethrows FWSS validateDataSet errors that do not match the terminal message", async () => {
      mockWarmStorageService.validateDataSet.mockRejectedValueOnce(new Error("ECONNREFUSED 127.0.0.1:8545"));
      await expect(service.isDataSetLive("0xprovider", 1n)).rejects.toThrow("ECONNREFUSED");
    });

    it("returns false when SP reports terminated even if FWSS RPC throws transiently", async () => {
      mockWarmStorageService.validateDataSet.mockRejectedValueOnce(new Error("ECONNREFUSED 127.0.0.1:8545"));
      fetchMock.mockResolvedValueOnce(
        new Response("Data set has been terminated due to unrecoverable proving failure", { status: 409 }),
      );
      await expect(service.isDataSetLive("0xprovider", 1n)).resolves.toBe(false);
    });

    it("posts an empty JSON body to the SP addPieces endpoint", async () => {
      await service.isDataSetLive("0xprovider", 42n);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
      expect(String(calledUrl)).toBe("https://sp.example/pdp/data-sets/42/pieces");
      expect(init.method).toBe("POST");
      expect(init.body).toBe("{}");
    });

    it("aborts when outer signal is already aborted", async () => {
      const ac = new AbortController();
      ac.abort();
      await expect(service.isDataSetLive("0xprovider", 1n, ac.signal)).rejects.toThrow();
    });
  });

  describe("isPieceLive", () => {
    it("returns true when PDPVerifier.pieceLive returns true", async () => {
      readContractMock.mockResolvedValueOnce(true);
      await expect(service.isPieceLive(1n, 42n)).resolves.toBe(true);
      expect(readContractMock).toHaveBeenCalledWith(
        expect.objectContaining({ chain: { id: 314 } }),
        expect.objectContaining({
          address: "0xpdp",
          functionName: "pieceLive",
          args: [1n, 42n],
        }),
      );
    });

    it("returns false when PDPVerifier.pieceLive returns false", async () => {
      readContractMock.mockResolvedValueOnce(false);
      await expect(service.isPieceLive(1n, 42n)).resolves.toBe(false);
    });

    it("throws when synapse client is not available", async () => {
      mockWalletSdkService.getSynapseClient.mockReturnValueOnce(null);
      await expect(service.isPieceLive(1n, 42n)).rejects.toThrow("Synapse client not available for pieceLive read");
    });

    it("propagates RPC errors", async () => {
      readContractMock.mockRejectedValueOnce(new Error("RPC down"));
      await expect(service.isPieceLive(1n, 42n)).rejects.toThrow("RPC down");
    });

    it("aborts when outer signal is already aborted", async () => {
      const ac = new AbortController();
      ac.abort();
      readContractMock.mockResolvedValueOnce(true);
      await expect(service.isPieceLive(1n, 42n, ac.signal)).rejects.toThrow();
    });
  });
});
