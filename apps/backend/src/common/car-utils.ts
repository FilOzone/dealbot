import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CarReader } from "@ipld/car";
import { cleanupTempCar, createCarFromPath } from "filecoin-pin/core/unixfs";
import { exporter } from "ipfs-unixfs-exporter";
import { CID } from "multiformats/cid";

export type CarValidationResult = {
  isValid: boolean;
  method: string;
  details: string;
  rebuiltRootCID?: string;
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
  constructor(private readonly reader: CarReader) {}

  async *get(cid: CID, _options?: unknown): AsyncGenerator<Uint8Array> {
    const block = await this.reader.get(cid);
    if (!block) {
      throw new Error(`Block not found for CID: ${cid.toString()}`);
    }
    yield block.bytes;
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
export async function unpackCarToPath(
  carBytes: Uint8Array,
  outputDir: string,
  expectedRootCID?: string,
): Promise<{ rootCID: CID; files: string[] }> {
  const reader = await CarReader.fromBytes(carBytes);
  const roots = await reader.getRoots();
  if (roots.length === 0) {
    throw new Error("CAR file has no roots");
  }
  let rootCID: CID | undefined;
  if (expectedRootCID) {
    rootCID = roots.find((cid) => cid.toString() === expectedRootCID);
  }
  if (!rootCID) {
    // For single-root CARs, proceed with that root even if it doesn't match
    // the expected CID so validation can report a mismatch instead of an
    // unpack error. Only reject when the CAR is multi-root and ambiguous.
    if (roots.length === 1) {
      rootCID = roots[0];
    } else {
      const rootList = roots.map((cid) => cid.toString()).join(", ");
      if (expectedRootCID) {
        throw new Error(`Expected root CID ${expectedRootCID} not found in CAR roots: ${rootList}`);
      }
      throw new Error(`Multi-root CAR files are not supported; found roots: ${rootList}`);
    }
  }

  const blockstore = new CarReaderBlockstore(reader);

  // export the DAG from the root CID
  const entry = await exporter(rootCID, blockstore);
  const files: string[] = [];

  await mkdir(outputDir, { recursive: true });

  if (entry.type === "file" || entry.type === "raw" || entry.type === "identity") {
    const outPath = join(outputDir, entry.name || "data");
    await pipeline(Readable.from(entry.content()), createWriteStream(outPath));
    files.push(outPath);
  } else if (entry.type === "directory") {
    for await (const child of entry.entries()) {
      // re-export each child to get its content
      const childEntry = await exporter(child.cid, blockstore);
      if (childEntry.type === "file" || childEntry.type === "raw" || childEntry.type === "identity") {
        const outPath = join(outputDir, child.name);
        await pipeline(Readable.from(childEntry.content()), createWriteStream(outPath));
        files.push(outPath);
      }
    }
  }

  return { rootCID, files };
}

/**
 * Validate CAR content by round-tripping: unpack the CAR, rebuild from extracted
 * content, and compare root CIDs. This proves CAR structure, UnixFS DAG integrity,
 * and content correctness.
 */
export async function validateCarContent(
  carBytes: Uint8Array,
  expectedRootCID: string,
  baseTempDir?: string,
): Promise<CarValidationResult> {
  const tempBase = join(baseTempDir ?? tmpdir(), `dealbot-validate-${randomBytes(6).toString("hex")}`);
  const extractDir = join(tempBase, "extracted");
  const errors: string[] = [];

  try {
    // unpack the CAR to extract original content
    let unpackResult: { rootCID: CID; files: string[] };
    try {
      unpackResult = await unpackCarToPath(carBytes, extractDir, expectedRootCID);
    } catch (err) {
      return {
        isValid: false,
        method: "car-content-validation",
        details: `Failed to unpack CAR: ${err instanceof Error ? err.message : String(err)}`,
        errors: [`unpack-error: ${err instanceof Error ? err.message : String(err)}`],
      };
    }

    // check that the CAR's root CID matches what we expect
    const carRootCID = unpackResult.rootCID.toString();
    if (carRootCID !== expectedRootCID) {
      errors.push(`root-cid-mismatch: CAR root CID ${carRootCID} !== expected ${expectedRootCID}`);
    }

    if (unpackResult.files.length === 0) {
      return {
        isValid: false,
        method: "car-content-validation",
        details: "CAR unpacked but no files were extracted",
        rebuiltRootCID: carRootCID,
        errors: ["no-files-extracted"],
      };
    }

    // rebuild a CAR from the extracted content
    let rebuiltRootCID: string;
    let rebuiltCarPath: string | undefined;
    try {
      const rebuiltResult = await createCarFromPath(unpackResult.files[0]);
      rebuiltCarPath = rebuiltResult.carPath;
      rebuiltRootCID = rebuiltResult.rootCid.toString();
    } catch (err) {
      return {
        isValid: false,
        method: "car-content-validation",
        details: `Failed to rebuild CAR: ${err instanceof Error ? err.message : String(err)}`,
        rebuiltRootCID: undefined,
        errors: [`rebuild-error: ${err instanceof Error ? err.message : String(err)}`],
      };
    } finally {
      if (rebuiltCarPath) {
        try {
          await cleanupTempCar(rebuiltCarPath);
        } catch {
          // best-effort cleanup
        }
      }
    }

    // compare rebuilt root CID with expected
    if (rebuiltRootCID !== expectedRootCID) {
      errors.push(`rebuilt-cid-mismatch: rebuilt root CID ${rebuiltRootCID} !== expected ${expectedRootCID}`);
    }

    const isValid = errors.length === 0;
    const details = isValid
      ? `CAR content validated: root CID ${expectedRootCID} matches after round-trip`
      : `CAR content validation failed: ${errors.join("; ")}`;

    return {
      isValid,
      method: "car-content-validation",
      details,
      rebuiltRootCID,
      errors: errors.length > 0 ? errors : undefined,
    };
  } finally {
    try {
      await rm(tempBase, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}
