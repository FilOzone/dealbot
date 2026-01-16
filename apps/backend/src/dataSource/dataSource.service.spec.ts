import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as path from "path";
import { IConfig } from "src/config/app.config.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSourceService } from "./dataSource.service.js";

describe("DataSourceService", () => {
  let service: DataSourceService;
  let mockConfigService: any;
  const testDatasetsPath = "./test-datasets";

  beforeEach(() => {
    mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === "dataset") {
          return {
            totalPages: 10,
            localDatasetsPath: testDatasetsPath,
            randomDatasetSizes: [
              10 << 10, // 10 KiB
              10 << 20, // 10 MB
              100 << 20, // 100 MB
            ],
          };
        }
        return null;
      }),
    };

    service = new DataSourceService(mockConfigService as unknown as ConfigService<IConfig, true>);
  });

  afterEach(async () => {
    // Clean up test datasets directory
    try {
      const files = await fs.promises.readdir(testDatasetsPath);
      for (const file of files) {
        await fs.promises.unlink(path.join(testDatasetsPath, file));
      }
      await fs.promises.rmdir(testDatasetsPath);
    } catch {
      // Directory might not exist, that's fine
    }
  });

  describe("generateRandomDataset", () => {
    it("should generate a random dataset with size within min/max range", async () => {
      const minSize = 1024; // 1 KiB
      const maxSize = 200 * 1024 * 1024; // 200 MB

      const result = await service.generateRandomDataset(minSize, maxSize);

      expect(result).toBeDefined();
      expect(result.name).toMatch(/^random-.*\.bin$/);
      expect(result.data).toBeInstanceOf(Buffer);
      expect(result.size).toBeGreaterThanOrEqual(minSize);
      expect(result.size).toBeLessThanOrEqual(maxSize);
    });

    it("should generate dataset with unique timestamp prefix and suffix", async () => {
      const minSize = 1024;
      const maxSize = 200 * 1024 * 1024;

      const result = await service.generateRandomDataset(minSize, maxSize);
      const dataStr = result.data.toString("utf8", 0, 100); // Check first 100 bytes

      expect(dataStr).toContain("DEALBOT_RANDOM_");
      expect(dataStr).toContain("_START_");
    });

    it("should generate different datasets on subsequent calls", async () => {
      const minSize = 1024;
      const maxSize = 200 * 1024 * 1024;

      const result1 = await service.generateRandomDataset(minSize, maxSize);
      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));
      const result2 = await service.generateRandomDataset(minSize, maxSize);

      expect(result1.name).not.toBe(result2.name);
      expect(Buffer.compare(result1.data, result2.data)).not.toBe(0);
    });

    it("should save generated dataset to local datasets path", async () => {
      const minSize = 1024;
      const maxSize = 200 * 1024 * 1024;

      const result = await service.generateRandomDataset(minSize, maxSize);
      const filePath = path.join(testDatasetsPath, result.name);

      await expect(fs.promises.access(filePath).then(() => true)).resolves.toBe(true);

      const fileData = await fs.promises.readFile(filePath);
      expect(Buffer.compare(fileData, result.data)).toBe(0);
    });

    it("should generate one of the three predefined sizes when in range", async () => {
      const minSize = 1024;
      const maxSize = 200 * 1024 * 1024;

      const possibleSizes = [
        10 << 10, // 10 KiB
        10 << 20, // 10 MB
        100 << 20, // 100 MB
      ];

      const result = await service.generateRandomDataset(minSize, maxSize);

      const isOneOfPredefinedSizes = possibleSizes.some(
        (size) => Math.abs(result.size - size) < 100, // Allow small variance for prefix/suffix
      );

      expect(isOneOfPredefinedSizes).toBe(true);
    });

    it("should handle size constraints when predefined sizes are out of range", async () => {
      const minSize = 50 * 1024 * 1024; // 50 MB
      const maxSize = 60 * 1024 * 1024; // 60 MB

      const result = await service.generateRandomDataset(minSize, maxSize);

      expect(result.size).toBeGreaterThanOrEqual(minSize);
      expect(result.size).toBeLessThanOrEqual(maxSize);
    });

    it("should create datasets directory if it does not exist", async () => {
      const minSize = 1024;
      const maxSize = 200 * 1024 * 1024;

      // Ensure directory doesn't exist
      try {
        await fs.promises.rmdir(testDatasetsPath);
      } catch {
        // Directory might not exist, that's fine
      }

      await service.generateRandomDataset(minSize, maxSize);

      const dirExists = await fs.promises
        .access(testDatasetsPath)
        .then(() => true)
        .catch(() => false);

      expect(dirExists).toBe(true);
    });

    it("should throw error if target size is too small for prefix and suffix", async () => {
      const minSize = 10; // Very small size
      const maxSize = 20;

      await expect(service.generateRandomDataset(minSize, maxSize)).rejects.toThrow("too small for prefix and suffix");
    });
  });

  describe("isRandomDataset", () => {
    it("should return true for valid random dataset filenames", () => {
      expect(service.isRandomDataset("random-2026-01-16T16-30-39-883Z-558c98b0fd1a54d1.bin")).toBe(true);
      expect(service.isRandomDataset("random-2024-12-31T23-59-59-999Z-1234567890abcdef.bin")).toBe(true);
    });

    it("should return false for non-random dataset filenames", () => {
      expect(service.isRandomDataset("regular-file.bin")).toBe(false);
      expect(service.isRandomDataset("random-file.bin")).toBe(false);
      expect(service.isRandomDataset("dataset.csv")).toBe(false);
      expect(service.isRandomDataset("")).toBe(false);
    });
  });

  describe("cleanupRandomDataset", () => {
    it("should delete random dataset file", async () => {
      const minSize = 1024;
      const maxSize = 200 * 1024 * 1024;

      // Generate a random dataset
      const result = await service.generateRandomDataset(minSize, maxSize);
      const filePath = path.join(testDatasetsPath, result.name);

      // Verify file exists
      await expect(fs.promises.access(filePath).then(() => true)).resolves.toBe(true);

      // Cleanup the file
      await service.cleanupRandomDataset(result.name);

      // Verify file is deleted
      await expect(fs.promises.access(filePath).catch(() => false)).resolves.toBe(false);
    });

    it("should not throw error for non-existent random dataset", async () => {
      await expect(
        service.cleanupRandomDataset("random-2026-01-16T16-30-39-883Z-558c98b0fd1a54d1.bin"),
      ).resolves.not.toThrow();
    });

    it("should skip cleanup for non-random files", async () => {
      const regularFileName = "regular-file.bin";
      const regularFilePath = path.join(testDatasetsPath, regularFileName);

      // Create a regular file
      await fs.promises.mkdir(testDatasetsPath, { recursive: true });
      await fs.promises.writeFile(regularFilePath, "test content");

      // Try to cleanup (should be skipped)
      await service.cleanupRandomDataset(regularFileName);

      // Verify file still exists
      await expect(fs.promises.access(regularFilePath).then(() => true)).resolves.toBe(true);
    });
  });
});
