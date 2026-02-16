import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CarReader } from "@ipld/car";
import { cleanupTempCar, createCarFromPath } from "filecoin-pin/core/unixfs";
import { CID } from "multiformats/cid";

export type UnixfsCarResult = {
  carData: Uint8Array;
  rootCID: CID;
  blockCIDs: CID[];
  blockCount: number;
  totalBlockSize: number;
  carSize: number;
};

export async function buildUnixfsCar(
  dataFile: { data: Buffer; size: number; name: string },
  { signal }: { signal?: AbortSignal } = {},
): Promise<UnixfsCarResult> {
  const safeName = dataFile.name?.trim() ? dataFile.name.replace(/[^\w.-]+/g, "_") : "dealbot-upload";
  const tempDir = join(tmpdir(), `dealbot-car-${randomBytes(6).toString("hex")}`);
  const tempFilePath = join(tempDir, safeName);
  let carPath: string | undefined;
  try {
    await mkdir(tempDir, { recursive: true });
    signal?.throwIfAborted();
    await writeFile(tempFilePath, dataFile.data);
    signal?.throwIfAborted();

    const carResult = await createCarFromPath(tempFilePath);
    carPath = carResult.carPath;
    signal?.throwIfAborted();

    const carBytes = await readFile(carPath);
    signal?.throwIfAborted();

    const reader = await CarReader.fromBytes(carBytes);
    signal?.throwIfAborted();

    const blockCIDs: CID[] = [];
    let totalBlockSize = 0;
    let blockCount = 0;

    for await (const block of reader.blocks()) {
      signal?.throwIfAborted();
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
