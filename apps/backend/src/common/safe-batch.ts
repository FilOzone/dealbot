import { keccak256, stringToBytes } from "viem";

/**
 * Safe Transaction Builder batch file. Field names and order follow the format the
 * Transaction Builder app reads and writes.
 */
export interface SafeBatchFile {
  version: string;
  chainId: string;
  createdAt: number;
  meta: {
    name: string;
    description: string;
    txBuilderVersion: string;
    createdFromSafeAddress: string;
    createdFromOwnerAddress: string;
    checksum?: string;
  };
  transactions: {
    to: string;
    value: string;
    data: string;
    contractMethod: null;
    contractInputsValues: null;
  }[];
}

/** JSON drops `undefined`; Safe's serializer maps it to null so the hash stays reproducible. */
const stringifyReplacer = (_key: string, value: unknown) => (value === undefined ? null : value);

/**
 * Safe's canonical serialization: recursive, with object keys sorted and the key list itself
 * folded into the output. Plain `JSON.stringify` does not produce this.
 */
function serializeJSONObject(json: unknown): string {
  if (Array.isArray(json)) {
    return `[${json.map((el) => serializeJSONObject(el)).join(",")}]`;
  }
  if (typeof json === "object" && json !== null) {
    const record = json as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    let acc = `{${JSON.stringify(keys, stringifyReplacer)}`;
    for (const key of keys) {
      acc += `${serializeJSONObject(record[key])},`;
    }
    return `${acc}}`;
  }
  return `${JSON.stringify(json, stringifyReplacer)}`;
}

/**
 * Reproduces `calculateChecksum` from Safe's Transaction Builder app
 * (safe-global/safe-react-apps, apps/tx-builder/src/lib/checksum.ts): canonical serialization
 * with `meta.name` blanked to `null`, then keccak256 of the UTF-8 bytes.
 *
 * The batch must be passed *without* `meta.checksum` — Safe validates by deleting that field
 * and recomputing, so including it here would never match. Any deviation (plain
 * `JSON.stringify`, unsorted keys, a real `meta.name`) yields a checksum Safe rejects, and the
 * operator gets a "this batch contains some changed properties" warning on every import.
 */
export function safeBatchChecksum(batch: SafeBatchFile): string {
  const { checksum: _omitted, ...meta } = batch.meta;
  return keccak256(stringToBytes(serializeJSONObject({ ...batch, meta: { ...meta, name: null } })));
}

/** Returns a copy of `batch` carrying the checksum Safe's Transaction Builder expects. */
export function withSafeBatchChecksum(batch: SafeBatchFile): SafeBatchFile {
  return { ...batch, meta: { ...batch.meta, checksum: safeBatchChecksum(batch) } };
}
