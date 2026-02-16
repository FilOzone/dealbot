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

    it("should fully consume the stream on a valid CAR", async () => {
      const originalData = randomBytes(4096);
      const originalFile = join(tempDir, "drain-valid.bin");
      await writeFile(originalFile, originalData);

      const carResult = await createCarFromPath(originalFile);
      const carBytes = await readFile(carResult.carPath);
      const rootCID = carResult.rootCid.toString();

      let chunksYielded = 0;
      async function* trackingStream(): AsyncIterable<Uint8Array> {
        for (let i = 0; i < carBytes.length; i += 1024) {
          chunksYielded++;
          yield carBytes.subarray(i, i + 1024);
        }
      }

      const totalChunks = Math.ceil(carBytes.length / 1024);
      const result = await validateCarContentStream(trackingStream(), rootCID);

      expect(result.isValid).toBe(true);
      expect(chunksYielded).toBe(totalChunks);

      await cleanupTempCar(carResult.carPath);
    });

    it("should close the stream when the CAR header is invalid", async () => {
      let chunksYielded = 0;
      let returnCalled = false;

      // Use a large stream with many small chunks to ensure
      // CarBlockIterator.fromIterable only reads the first few for the header
      const trackingIterable: AsyncIterable<Uint8Array> = {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (chunksYielded >= 100) {
                return { done: true, value: undefined };
              }
              chunksYielded++;
              // Yield 1 byte at a time to ensure header parsing fails before consuming all
              return { done: false, value: randomBytes(1) };
            },
            async return() {
              returnCalled = true;
              return { done: true, value: undefined };
            },
          };
        },
      };

      const result = await validateCarContentStream(
        trackingIterable,
        "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
      );

      expect(result.isValid).toBe(false);
      expect(result.errors!.some((e) => e.includes("car-read-error"))).toBe(true);
      // The stream should be closed via .return(), NOT left open
      expect(returnCalled).toBe(true);
    });

    it("should close the stream early when block verification fails", async () => {
      const originalData = randomBytes(4096);
      const originalFile = join(tempDir, "drain-corrupt.bin");
      await writeFile(originalFile, originalData);

      const carResult = await createCarFromPath(originalFile);
      const carBytes = await readFile(carResult.carPath);
      const rootCID = carResult.rootCid.toString();

      // Corrupt data in the middle (after header, in block data)
      const corrupted = Buffer.from(carBytes);
      const midpoint = Math.floor(corrupted.length / 2);
      for (let i = midpoint; i < midpoint + 256 && i < corrupted.length; i++) {
        corrupted[i] = corrupted[i] ^ 0xff;
      }

      let returnCalled = false;

      const trackingIterable: AsyncIterable<Uint8Array> = {
        [Symbol.asyncIterator]() {
          let offset = 0;
          return {
            async next() {
              if (offset >= corrupted.length) {
                return { done: true as const, value: undefined };
              }
              const chunk = corrupted.subarray(offset, offset + 1024);
              offset += 1024;
              return { done: false as const, value: chunk };
            },
            async return() {
              returnCalled = true;
              return { done: true as const, value: undefined };
            },
          };
        },
      };

      const result = await validateCarContentStream(trackingIterable, rootCID);

      expect(result.isValid).toBe(false);
      expect(result.errors!.some((e) => e.includes("cid-verify-error"))).toBe(true);
      // The break from for-await calls .return() on the CarBlockIterator, which
      // signals stream closure. For small files the CAR library may have already
      // buffered all chunks, but .return() is still called to release resources.
      expect(returnCalled).toBe(true);

      await cleanupTempCar(carResult.carPath);
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
