import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTempCar, createCarFromPath } from "filecoin-pin/core/unixfs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unpackCarToPath, validateCarContent } from "./car-utils.js";

describe("car-utils", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `car-utils-test-${randomBytes(6).toString("hex")}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("unpackCarToPath round-trip", () => {
    it("should round-trip: create CAR → unpack → rebuild → matching root CIDs", async () => {
      // Generate random 1MiB data
      const dataSize = 1 * 1024 * 1024;
      const originalData = randomBytes(dataSize);
      const originalFile = join(tempDir, "original.bin");
      await writeFile(originalFile, originalData);

      // Create CAR from original file
      const carResult = await createCarFromPath(originalFile);
      const carBytes = await readFile(carResult.carPath);
      const rootCID1 = carResult.rootCid.toString();

      // Unpack CAR to extract content
      const extractDir = join(tempDir, "extracted");
      const unpackResult = await unpackCarToPath(carBytes, extractDir);

      expect(unpackResult.rootCID.toString()).toBe(rootCID1);
      expect(unpackResult.files).toHaveLength(1);

      // Verify extracted file size matches original
      const extractedStat = await stat(unpackResult.files[0]);
      expect(extractedStat.size).toBe(dataSize);

      // Rebuild CAR from extracted content
      const rebuiltResult = await createCarFromPath(unpackResult.files[0]);
      const rootCID2 = rebuiltResult.rootCid.toString();

      expect(rootCID2).toBe(rootCID1);

      // Cleanup
      await cleanupTempCar(carResult.carPath);
      await cleanupTempCar(rebuiltResult.carPath);
    }, 30_000);

    it("should preserve file content exactly through round-trip", async () => {
      const originalData = randomBytes(1024);
      const originalFile = join(tempDir, "small.bin");
      await writeFile(originalFile, originalData);

      const carResult = await createCarFromPath(originalFile);
      const carBytes = await readFile(carResult.carPath);

      const extractDir = join(tempDir, "extracted");
      const unpackResult = await unpackCarToPath(carBytes, extractDir);

      const extractedData = await readFile(unpackResult.files[0]);
      expect(Buffer.compare(extractedData, originalData)).toBe(0);

      await cleanupTempCar(carResult.carPath);
    });
  });

  describe("validateCarContent", () => {
    it("should return isValid=true for a valid CAR with matching root CID", async () => {
      const originalData = randomBytes(4096);
      const originalFile = join(tempDir, "valid.bin");
      await writeFile(originalFile, originalData);

      const carResult = await createCarFromPath(originalFile);
      const carBytes = await readFile(carResult.carPath);
      const rootCID = carResult.rootCid.toString();

      const result = await validateCarContent(carBytes, rootCID);

      expect(result.isValid).toBe(true);
      expect(result.method).toBe("car-content-validation");
      expect(result.rebuiltRootCID).toBe(rootCID);
      expect(result.errors).toBeUndefined();

      await cleanupTempCar(carResult.carPath);
    });

    it("should return isValid=false for wrong expected root CID", async () => {
      const originalData = randomBytes(4096);
      const originalFile = join(tempDir, "wrong-cid.bin");
      await writeFile(originalFile, originalData);

      const carResult = await createCarFromPath(originalFile);
      const carBytes = await readFile(carResult.carPath);

      const fakeRootCID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
      const result = await validateCarContent(carBytes, fakeRootCID);

      expect(result.isValid).toBe(false);
      expect(result.method).toBe("car-content-validation");
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.errors!.some((e) => e.includes("mismatch"))).toBe(true);

      await cleanupTempCar(carResult.carPath);
    });

    it("should return isValid=false for corrupted CAR bytes", async () => {
      // Create valid CAR first to get a real root CID
      const originalData = randomBytes(4096);
      const originalFile = join(tempDir, "corrupt.bin");
      await writeFile(originalFile, originalData);

      const carResult = await createCarFromPath(originalFile);
      const carBytes = await readFile(carResult.carPath);
      const rootCID = carResult.rootCid.toString();

      // Corrupt the CAR bytes (modify data in the middle)
      const corrupted = Buffer.from(carBytes);
      const midpoint = Math.floor(corrupted.length / 2);
      for (let i = midpoint; i < midpoint + 256 && i < corrupted.length; i++) {
        corrupted[i] = corrupted[i] ^ 0xff;
      }

      const result = await validateCarContent(corrupted, rootCID);

      expect(result.isValid).toBe(false);
      expect(result.method).toBe("car-content-validation");

      await cleanupTempCar(carResult.carPath);
    });

    it("should return isValid=false for completely invalid bytes", async () => {
      const garbage = randomBytes(1024);
      const result = await validateCarContent(garbage, "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi");

      expect(result.isValid).toBe(false);
      expect(result.method).toBe("car-content-validation");
      expect(result.errors).toBeDefined();
      expect(result.errors!.some((e) => e.includes("unpack-error"))).toBe(true);
    });
  });
});
