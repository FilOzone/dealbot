import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CarReader } from "@ipld/car";
import { cleanupTempCar, createCarFromPath } from "filecoin-pin/core/unixfs";
import { CID } from "multiformats/cid";
import { identity } from "multiformats/hashes/identity";
import type { MultihashHasher } from "multiformats/hashes/interface";
import { sha256 } from "multiformats/hashes/sha2";

export type CarValidationResult = {
  isValid: boolean;
  method: string;
  details: string;
  verifiedRootCID?: string;
  errors?: string[];
};

export type UnixfsCarResult = {
  carData: Uint8Array;
  rootCID: CID;
  blockCIDs: CID[];
  blockCount: number;
  totalBlockSize: number;
  carSize: number;
};

class CarReaderBlockstore {
  constructor(
    private readonly reader: CarReader,
    private readonly verifyBlocks: boolean = false,
  ) {}

  async get(cid: CID, _options?: unknown): Promise<Uint8Array> {
    const block = await this.reader.get(cid);
    if (!block) {
      throw new Error(`Block not found for CID: ${cid.toString()}`);
    }
    if (this.verifyBlocks) {
      await verifyCidBytes(cid, block.bytes);
    }
    return block.bytes;
  }
}

const supportedHashers: MultihashHasher[] = [sha256, identity];

function getHasher(code: number): MultihashHasher | undefined {
  return supportedHashers.find((hasher) => hasher.code === code);
}

async function verifyCidBytes(cid: CID, bytes: Uint8Array): Promise<void> {
  const hasher = getHasher(cid.multihash.code);
  if (!hasher) {
    throw new Error(`Unsupported multihash code ${cid.multihash.code} for CID ${cid.toString()}`);
  }
  const digest = await hasher.digest(bytes);
  if (Buffer.compare(Buffer.from(digest.bytes), Buffer.from(cid.multihash.bytes)) !== 0) {
    throw new Error(`CID hash mismatch for ${cid.toString()}`);
  }
}

export async function buildUnixfsCar(dataFile: { data: Buffer; size: number; name: string }): Promise<UnixfsCarResult> {
  const safeName = dataFile.name?.trim() ? dataFile.name.replace(/[^\w.-]+/g, "_") : "dealbot-upload";
  const tempDir = join(tmpdir(), `dealbot-car-${randomBytes(6).toString("hex")}`);
  const tempFilePath = join(tempDir, safeName);
  let carPath: string | undefined;
  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(tempFilePath, dataFile.data);

    const carResult = await createCarFromPath(tempFilePath);
    carPath = carResult.carPath;
    const carBytes = await readFile(carPath);
    const reader = await CarReader.fromBytes(carBytes);

    const blockCIDs: CID[] = [];
    let totalBlockSize = 0;
    let blockCount = 0;

    for await (const block of reader.blocks()) {
      blockCIDs.push(block.cid);
      totalBlockSize += block.bytes.length;
      blockCount += 1;
    }

    return {
      carData: carBytes,
      rootCID: carResult.rootCid,
      blockCIDs,
      blockCount,
      totalBlockSize,
      carSize: carBytes.length,
    };
  } finally {
    if (carPath) {
      try {
        await cleanupTempCar(carPath);
      } catch {
        // Best-effort cleanup; avoid masking the original error.
      }
    }
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; avoid masking the original error.
    }
  }
}

/**
 * Unpack a CAR file's content to disk by decoding the UnixFS DAG.
 * Returns the root CID and list of extracted file paths. If expectedRootCID is
 * provided, it will be used to select the root when multiple roots are present.
 */
/**
 * Validate CAR content by verifying that all CAR blocks hash to their CIDs and
 * that the expected root is present. This avoids reconstruction and relies on
 * CID integrity for validation.
 */
export async function validateCarContent(carBytes: Uint8Array, expectedRootCID: string): Promise<CarValidationResult> {
  const errors: string[] = [];
  let reader: CarReader;
  try {
    reader = await CarReader.fromBytes(carBytes);
  } catch (err) {
    return {
      isValid: false,
      method: "car-content-validation",
      details: `Failed to read CAR: ${err instanceof Error ? err.message : String(err)}`,
      errors: [`car-read-error: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  let roots: CID[];
  try {
    roots = await reader.getRoots();
  } catch (err) {
    return {
      isValid: false,
      method: "car-content-validation",
      details: `Failed to read CAR roots: ${err instanceof Error ? err.message : String(err)}`,
      errors: [`car-roots-error: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  if (roots.length === 0) {
    return {
      isValid: false,
      method: "car-content-validation",
      details: "CAR file has no roots",
      errors: ["car-roots-missing"],
    };
  }

  let rootCID: CID | undefined;
  if (expectedRootCID) {
    rootCID = roots.find((cid) => cid.toString() === expectedRootCID);
  }

  if (!rootCID) {
    if (roots.length === 1) {
      rootCID = roots[0];
      errors.push(`root-cid-mismatch: CAR root CID ${rootCID.toString()} !== expected ${expectedRootCID}`);
    } else {
      const rootList = roots.map((cid) => cid.toString()).join(", ");
      return {
        isValid: false,
        method: "car-content-validation",
        details: `Expected root CID ${expectedRootCID} not found in CAR roots: ${rootList}`,
        errors: [`root-cid-mismatch: expected ${expectedRootCID} not found in CAR roots: ${rootList}`],
      };
    }
  }

  let verifiedBlocks = 0;
  let rootBlockFound = false;
  for await (const block of reader.blocks()) {
    if (block.cid.toString() === rootCID.toString()) {
      rootBlockFound = true;
    }
    try {
      await verifyCidBytes(block.cid, block.bytes);
      verifiedBlocks += 1;
    } catch (err) {
      errors.push(`cid-verify-error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!rootBlockFound) {
    errors.push(`root-block-missing: ${rootCID.toString()}`);
  }

  const isValid = errors.length === 0;
  const rootCIDStr = rootCID.toString();
  const details = isValid
    ? `CAR content validated: verified ${verifiedBlocks} blocks for root CID ${rootCIDStr}`
    : `CAR content validation failed: ${errors.join("; ")}`;

  return {
    isValid,
    method: "car-content-validation",
    details,
    verifiedRootCID: rootCIDStr,
    errors: errors.length > 0 ? errors : undefined,
  };
}
