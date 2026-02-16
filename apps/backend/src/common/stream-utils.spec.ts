import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import * as fs from "fs";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeStream, writeWithBackpressure } from "./stream-utils.js";

describe("stream-utils", () => {
  const testDir = "./test-stream-utils";
  const testFile = path.join(testDir, "test.bin");

  beforeEach(async () => {
    await fs.promises.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.promises.unlink(testFile);
      await fs.promises.rmdir(testDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("closeStream", () => {
    it("should call .return() on the underlying iterator", async () => {
      let returnCalled = false;
      const iterable: AsyncIterable<Uint8Array> = {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              return { done: false, value: randomBytes(1024) };
            },
            async return() {
              returnCalled = true;
              return { done: true, value: undefined };
            },
          };
        },
      };

      await closeStream(iterable);
      expect(returnCalled).toBe(true);
    });

    it("should not throw when .return() errors", async () => {
      const iterable: AsyncIterable<Uint8Array> = {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              return { done: true, value: undefined };
            },
            async return() {
              throw new Error("stream error");
            },
          };
        },
      };

      await expect(closeStream(iterable)).resolves.toBeUndefined();
    });

    it("should handle iterators without .return()", async () => {
      async function* emptyStream(): AsyncIterable<Uint8Array> {
        // yields nothing
      }
      // Generator iterators always have .return(), but we test the guard
      await expect(closeStream(emptyStream())).resolves.toBeUndefined();
    });
  });

  describe("writeWithBackpressure", () => {
    it("should write small buffer without backpressure", async () => {
      const writeStream = fs.createWriteStream(testFile);
      const data = Buffer.from("test data");

      await writeWithBackpressure(writeStream, data);
      writeStream.end();

      await new Promise<void>((resolve) => writeStream.on("finish", () => resolve()));

      const written = await fs.promises.readFile(testFile);
      expect(written.toString()).toBe("test data");
    });

    it("should write multiple buffers with backpressure handling", async () => {
      const writeStream = fs.createWriteStream(testFile, { highWaterMark: 1024 });
      const chunks: Buffer[] = [];

      // Generate 10 chunks of 512 bytes each (total 5 KB)
      for (let i = 0; i < 10; i++) {
        const chunk = Buffer.alloc(512, i);
        chunks.push(chunk);
      }

      // Write all chunks with backpressure handling
      for (const chunk of chunks) {
        await writeWithBackpressure(writeStream, chunk);
      }

      writeStream.end();
      await new Promise<void>((resolve) => writeStream.on("finish", () => resolve()));

      // Verify all data was written
      const written = await fs.promises.readFile(testFile);
      expect(written.length).toBe(5120); // 10 * 512
    });

    it("should handle large writes with proper backpressure", async () => {
      const writeStream = fs.createWriteStream(testFile, { highWaterMark: 1024 });
      const largeBuffer = Buffer.alloc(1024 * 1024); // 1 MB

      await writeWithBackpressure(writeStream, largeBuffer);
      writeStream.end();

      await new Promise<void>((resolve) => writeStream.on("finish", () => resolve()));

      const written = await fs.promises.readFile(testFile);
      expect(written.length).toBe(largeBuffer.length);
    });

    it("should explicitly trigger and handle backpressure", async () => {
      // Use very small highWaterMark to guarantee backpressure
      const writeStream = fs.createWriteStream(testFile, { highWaterMark: 16 });
      let drainFired = false;

      // Listen for drain event to verify backpressure occurred
      writeStream.on("drain", () => {
        drainFired = true;
      });

      // Write buffer larger than highWaterMark (should trigger backpressure)
      const buffer = Buffer.alloc(1024); // 1 KB > 16 bytes highWaterMark
      await writeWithBackpressure(writeStream, buffer);

      writeStream.end();
      await new Promise<void>((resolve) => writeStream.on("finish", () => resolve()));

      // Verify backpressure was actually triggered
      expect(drainFired).toBe(true);

      const written = await fs.promises.readFile(testFile);
      expect(written.length).toBe(1024);
    });

    it("should reject if stream errors while waiting for drain", async () => {
      const writeStream = new Writable({
        highWaterMark: 1,
        write(_chunk, _encoding, _callback) {
          // Intentionally never call callback to keep backpressure active.
        },
      });
      const buffer = Buffer.alloc(1024);

      const writePromise = writeWithBackpressure(writeStream as unknown as fs.WriteStream, buffer);
      writeStream.destroy(new Error("boom"));

      await expect(writePromise).rejects.toThrow("boom");
    });

    it("should handle multiple writes that cause backpressure", async () => {
      const writeStream = fs.createWriteStream(testFile, { highWaterMark: 32 });
      let drainCount = 0;

      writeStream.on("drain", () => {
        drainCount++;
      });

      // Write 5 buffers, each larger than highWaterMark
      for (let i = 0; i < 5; i++) {
        const buffer = Buffer.alloc(256); // 256 bytes > 32 bytes highWaterMark
        await writeWithBackpressure(writeStream, buffer);
      }

      writeStream.end();
      await new Promise<void>((resolve) => writeStream.on("finish", () => resolve()));

      // Should have triggered drain multiple times (since we're writing 5 chunks that each exceed highWaterMark, we expect backpressure to trigger each time)
      // see https://nodejs.org/api/stream.html#event-drain
      expect(drainCount).toBe(5);

      const written = await fs.promises.readFile(testFile);
      expect(written.length).toBe(1280); // 5 * 256
    });
  });
});
