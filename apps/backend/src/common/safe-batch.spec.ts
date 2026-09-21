import { describe, expect, it } from "vitest";
import { type SafeBatchFile, safeBatchChecksum, withSafeBatchChecksum } from "./safe-batch.js";

function makeBatch(overrides: Partial<SafeBatchFile> = {}): SafeBatchFile {
  return {
    version: "1.0",
    chainId: "314159",
    createdAt: 1700000000000,
    meta: {
      name: "Stuck rail settlements",
      description: "settleTerminatedRailWithoutValidation",
      txBuilderVersion: "1.16.5",
      createdFromSafeAddress: "0x1111111111111111111111111111111111111111",
      createdFromOwnerAddress: "",
    },
    transactions: [
      {
        to: "0x2222222222222222222222222222222222222222",
        value: "0",
        data: "0xdeadbeef",
        contractMethod: null,
        contractInputsValues: null,
      },
    ],
    ...overrides,
  };
}

describe("safeBatchChecksum", () => {
  /**
   * Derived by running `calculateChecksum` from Safe's own Transaction Builder
   * (safe-global/safe-react-apps, apps/tx-builder/src/lib/checksum.ts) over `makeBatch()`,
   * with viem's keccak256 standing in for `web3.utils.sha3` (identical for a non-hex string).
   * If this fails, our serialization has drifted from Safe's and every generated batch will
   * import with a "changed properties" warning.
   */
  it("matches Safe's Transaction Builder checksum for a known batch", () => {
    expect(safeBatchChecksum(makeBatch())).toBe("0x969650a6ee2bd53c1d9fff62c855b19c06cbf4d9317b65af47d83f02cff3fa93");
  });

  it("ignores meta.name, which Safe blanks before hashing", () => {
    const a = safeBatchChecksum(makeBatch());
    const b = safeBatchChecksum(makeBatch({ meta: { ...makeBatch().meta, name: "Something else" } }));
    expect(a).toBe(b);
  });

  it("is stable under key insertion order, since Safe sorts keys", () => {
    const batch = makeBatch();
    const reordered = {
      transactions: batch.transactions,
      meta: batch.meta,
      createdAt: batch.createdAt,
      chainId: batch.chainId,
      version: batch.version,
    } as SafeBatchFile;
    expect(safeBatchChecksum(reordered)).toBe(safeBatchChecksum(batch));
  });

  it("excludes an existing meta.checksum, matching Safe's validation path", () => {
    const withChecksum = withSafeBatchChecksum(makeBatch());
    expect(safeBatchChecksum(withChecksum)).toBe(withChecksum.meta.checksum);
  });

  it("changes when a transaction changes", () => {
    const other = makeBatch();
    other.transactions = [{ ...other.transactions[0], data: "0xfeedface" }];
    expect(safeBatchChecksum(other)).not.toBe(safeBatchChecksum(makeBatch()));
  });
});
