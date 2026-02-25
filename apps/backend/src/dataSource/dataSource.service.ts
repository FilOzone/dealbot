import * as crypto from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as path from "path";
import { toStructuredError } from "../common/logging.js";
import { writeWithBackpressure } from "../common/stream-utils.js";
import type { DataFile } from "../common/types.js";
import type { IConfig, IDatasetConfig } from "../config/app.config.js";

@Injectable()
export class DataSourceService {
  private readonly logger: Logger;

  constructor(private readonly configService: ConfigService<IConfig, true>) {
    this.logger = new Logger(DataSourceService.name);
  }

  async generateRandomDataset(minSize: number, maxSize: number): Promise<DataFile> {
    this.logger.log(`Generating random dataset with min size ${minSize} and max size ${maxSize}`);

    try {
      // Get configured dataset sizes from config
      const possibleSizes = this.configService.get<IDatasetConfig>("dataset").randomDatasetSizes;

      // Filter sizes that are within the min/max range
      const validSizes = possibleSizes.filter((size) => size >= minSize && size <= maxSize);

      // If no valid sizes in range, use a random size within the range
      const targetSize =
        validSizes.length > 0
          ? validSizes[Math.floor(Math.random() * validSizes.length)]
          : Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;

      // Generate unique timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const uniqueId = crypto.randomBytes(8).toString("hex");

      // Create prefix and suffix with timestamp and unique ID
      const prefix = `DEALBOT_RANDOM_${timestamp}_${uniqueId}_START_`;
      const suffix = `_END_${uniqueId}_${timestamp}_DEALBOT_RANDOM`;

      // Calculate how much random data we need (excluding prefix and suffix)
      const prefixBuffer = Buffer.from(prefix, "utf8");
      const suffixBuffer = Buffer.from(suffix, "utf8");
      const randomDataSize = targetSize - prefixBuffer.length - suffixBuffer.length;

      if (randomDataSize <= 0) {
        throw new Error(`Target size ${targetSize} is too small for prefix and suffix`);
      }

      // Create filename
      const fileName = `random-${timestamp}-${uniqueId}.bin`;

      // Ensure datasets directory exists
      const datasetsPath = this.configService.get<IDatasetConfig>("dataset").localDatasetsPath;
      await fs.promises.mkdir(datasetsPath, { recursive: true });

      // Save to file using streaming
      const filePath = path.join(datasetsPath, fileName);
      await this.writeRandomDataStream(filePath, prefixBuffer, randomDataSize, suffixBuffer);

      // Read the file back (this is necessary for the DataFile interface)
      const fileData = await fs.promises.readFile(filePath);

      this.logger.log(`Generated random dataset: ${fileName} (${fileData.length} bytes)`);

      return {
        name: fileName,
        data: fileData,
        size: fileData.length,
      };
    } catch (error) {
      this.logger.error({
        event: "generate_random_dataset_failed",
        message: "Failed to generate random dataset",
        error: toStructuredError(error),
      });
      throw error;
    }
  }

  private async writeRandomDataStream(
    filePath: string,
    prefixBuffer: Buffer,
    randomDataSize: number,
    suffixBuffer: Buffer,
  ): Promise<void> {
    const writeStream = fs.createWriteStream(filePath);
    const chunkSize = 1024 * 1024; // 1 MB chunks

    // Helper to wait for stream finish event
    const waitForFinish = () =>
      new Promise<void>((resolve, reject) => {
        writeStream.once("finish", resolve);
        writeStream.once("error", reject);
      });

    try {
      // Write prefix
      await writeWithBackpressure(writeStream, prefixBuffer);

      // Write random data in chunks with backpressure handling
      let remainingBytes = randomDataSize;
      while (remainingBytes > 0) {
        const currentChunkSize = Math.min(chunkSize, remainingBytes);
        const chunk = crypto.randomBytes(currentChunkSize);
        await writeWithBackpressure(writeStream, chunk);
        remainingBytes -= currentChunkSize;
      }

      // Write suffix and close
      await writeWithBackpressure(writeStream, suffixBuffer);
      writeStream.end();

      // Wait for finish event
      await waitForFinish();
    } finally {
      writeStream.destroy();
    }
  }

  /**
   * Check if a filename matches the random dataset pattern
   * @param fileName - Name of the file to check
   * @returns true if the file is a generated random dataset
   */
  isRandomDataset(fileName: string): boolean {
    return /^random-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{16}\.bin$/.test(fileName);
  }

  /**
   * Clean up a random dataset file if it exists
   * @param fileName - Name of the file to clean up
   */
  async cleanupRandomDataset(fileName: string): Promise<void> {
    if (!this.isRandomDataset(fileName)) {
      this.logger.debug(`Skipping cleanup for non-random file: ${fileName}`);
      return;
    }

    try {
      const datasetsPath = this.configService.get<IDatasetConfig>("dataset").localDatasetsPath;
      const filePath = path.join(datasetsPath, fileName);

      await fs.promises.unlink(filePath);
      this.logger.log(`Cleaned up random dataset: ${fileName}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.logger.debug(`Random dataset file not found for cleanup: ${fileName}`);
      } else {
        this.logger.warn({
          event: "cleanup_random_dataset_failed",
          message: `Failed to cleanup random dataset ${fileName}`,
          fileName,
          error: toStructuredError(error),
        });
      }
    }
  }
}
