import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTempCar, createCarFromPath } from "filecoin-pin/core/unixfs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateCarContentStream } from "./car-utils.js";

describe("car-utils", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `car-utils-test-${randomBytes(6).toString("hex")}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("validateCarContentStream", () => {
    async function* chunked(bytes: Uint8Array, chunkSize: number = 1024): AsyncIterable<Uint8Array> {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        yield bytes.subarray(i, i + chunkSize);
      }
    }

    it("should return isValid=true for a valid CAR with matching root CID", async () => {
      const originalData = randomBytes(4096);
      const originalFile = join(tempDir, "valid.bin");
      await writeFile(originalFile, originalData);

      const carResult = await createCarFromPath(originalFile);
      const carBytes = await readFile(carResult.carPath);
      const rootCID = carResult.rootCid.toString();

      const result = await validateCarContentStream(chunked(carBytes), rootCID);

      expect(result.isValid).toBe(true);
      expect(result.method).toBe("car-content-validation");
      expect(result.verifiedRootCID).toBe(rootCID);
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
      const result = await validateCarContentStream(chunked(carBytes), fakeRootCID);

      expect(result.isValid).toBe(false);
      expect(result.method).toBe("car-content-validation");
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.errors!.some((e) => e.includes("root-cid-mismatch"))).toBe(true);

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

      const result = await validateCarContentStream(chunked(corrupted), rootCID);

      expect(result.isValid).toBe(false);
      expect(result.method).toBe("car-content-validation");
      expect(result.errors).toBeDefined();

      await cleanupTempCar(carResult.carPath);
    });

    it("should return isValid=false for completely invalid bytes", async () => {
      const garbage = randomBytes(1024);
      const result = await validateCarContentStream(
        chunked(garbage),
        "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
      );

      expect(result.isValid).toBe(false);
      expect(result.method).toBe("car-content-validation");
      expect(result.errors).toBeDefined();
      expect(result.errors!.some((e) => e.includes("car-read-error"))).toBe(true);
    });

    it("should validate CAR content from a stream", async () => {
      const originalData = randomBytes(4096);
      const originalFile = join(tempDir, "stream.bin");
      await writeFile(originalFile, originalData);

      const carResult = await createCarFromPath(originalFile);
      const carBytes = await readFile(carResult.carPath);
      const rootCID = carResult.rootCid.toString();
      const result = await validateCarContentStream(chunked(carBytes), rootCID);

      expect(result.isValid).toBe(true);
      expect(result.method).toBe("car-content-validation");
      expect(result.verifiedRootCID).toBe(rootCID);

      await cleanupTempCar(carResult.carPath);
    });
  });
});
