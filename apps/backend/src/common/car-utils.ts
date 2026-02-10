import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CarReader } from "@ipld/car";
import { MemoryBlockstore } from "blockstore-core/memory";
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
 * Returns the root CID and list of extracted file paths.
 */
export async function unpackCarToPath(
  carBytes: Uint8Array,
  outputDir: string,
): Promise<{ rootCID: CID; files: string[] }> {
  const reader = await CarReader.fromBytes(carBytes);
  const roots = await reader.getRoots();
  if (roots.length === 0) {
    throw new Error("CAR file has no roots");
  }
  const rootCID = roots[0];

  // populate a MemoryBlockstore with all blocks from the CAR
  const blockstore = new MemoryBlockstore();
  for await (const block of reader.blocks()) {
    await blockstore.put(block.cid, block.bytes);
  }

  // export the DAG from the root CID
  const entry = await exporter(rootCID, blockstore);
  const files: string[] = [];

  await mkdir(outputDir, { recursive: true });

  if (entry.type === "file" || entry.type === "raw" || entry.type === "identity") {
    const outPath = join(outputDir, entry.name || "data");
    const chunks: Uint8Array[] = [];
    for await (const chunk of entry.content()) {
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);
    await writeFile(outPath, data);
    files.push(outPath);
  } else if (entry.type === "directory") {
    for await (const child of entry.entries()) {
      // re-export each child to get its content
      const childEntry = await exporter(child.cid, blockstore);
      if (childEntry.type === "file" || childEntry.type === "raw" || childEntry.type === "identity") {
        const outPath = join(outputDir, child.name);
        const chunks: Uint8Array[] = [];
        for await (const chunk of childEntry.content()) {
          chunks.push(chunk);
        }
        const data = Buffer.concat(chunks);
        await writeFile(outPath, data);
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
      unpackResult = await unpackCarToPath(carBytes, extractDir);
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
