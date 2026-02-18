import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildUnixfsCar } from "./car-utils.js";

describe("car-utils", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `car-utils-test-${randomBytes(6).toString("hex")}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("buildUnixfsCar", () => {
    it("produces CAR data, root CID, and block CIDs from file data", async () => {
      const data = randomBytes(4096);
      const result = await buildUnixfsCar({
        data: Buffer.from(data),
        size: data.length,
        name: "test.bin",
      });

      expect(result.carData.length).toBeGreaterThan(0);
      expect(result.rootCID).toBeDefined();
      expect(result.blockCIDs.length).toBeGreaterThanOrEqual(1);
      expect(result.blockCount).toBe(result.blockCIDs.length);
      expect(result.totalBlockSize).toBeGreaterThan(0);
      expect(result.carSize).toBe(result.carData.length);
    });
  });
});
