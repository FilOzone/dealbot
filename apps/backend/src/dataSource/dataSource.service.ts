import * as crypto from "node:crypto";
import { Readable } from "node:stream";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as path from "path";
import { toStructuredError } from "../common/logging.js";
import { writeWithBackpressure } from "../common/stream-utils.js";
import type { DataFile } from "../common/types.js";
import type { IConfig, IDatasetConfig } from "../config/app.config.js";

export interface DeterministicBytesOptions {
  /** Arbitrary namespace/key to scope the output (e.g. "nonce", "seed:round-1") */
  key: string;
  /** Number of pseudo-random bytes to generate */
  bytesNeeded: number;
  /** Optional: provider address or any additional entropy source */
  providerAddress?: string;
  /** Optional: total size of the piece (used for key derivation to ensure same CID) */
  size?: number;
}

export interface DeterministicBytesResult {
  bytes: Buffer;
  derivedKey: Buffer;
}

const AES_KEY_LENGTH = 32; // AES-256
const AES_IV_LENGTH = 16; // AES-CTR IV
const UINT64_BUFFER_LENGTH = 8;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MiB — default pull-check piece size

@Injectable()
export class DataSourceService {
  private readonly logger: Logger;

  constructor(private readonly configService: ConfigService<IConfig, true>) {
    this.logger = new Logger(DataSourceService.name);
  }

  async generateRandomDataset(minSize: number, maxSize: number): Promise<DataFile> {
    this.logger.log({
      event: "random_dataset_generating",
      message: "Generating random dataset",
      minSize,
      maxSize,
    });

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

      this.logger.log({
        event: "random_dataset_generated",
        message: "Generated random dataset",
        fileName,
        sizeBytes: fileData.length,
      });

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
      this.logger.debug({
        event: "cleanup_skipped",
        message: "Skipping cleanup for non-random file",
        fileName,
      });
      return;
    }

    try {
      const datasetsPath = this.configService.get<IDatasetConfig>("dataset").localDatasetsPath;
      const filePath = path.join(datasetsPath, fileName);

      await fs.promises.unlink(filePath);
      this.logger.log({
        event: "random_dataset_cleaned_up",
        message: "Cleaned up random dataset",
        fileName,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.logger.debug({
          event: "cleanup_file_not_found",
          message: "Random dataset file not found for cleanup",
          fileName,
        });
      } else {
        this.logger.warn({
          event: "cleanup_random_dataset_failed",
          message: "Failed to cleanup random dataset",
          fileName,
          error: toStructuredError(error),
        });
      }
    }
  }

  // Deterministic Random data generation
  /**
   * Generates a deterministic pseudo-random byte buffer from the provided seeds.
   *
   * Algorithm:
   *   1. Serialize all seed components to binary (BigUInt64BE for numeric values).
   *   2. SHA-256 hash the combined seed → 32-byte AES key.
   *   3. AES-256-CTR encrypt a zero-filled buffer with a static IV.
   *      The keystream itself is the pseudo-random output.
   *
   * Properties:
   *   - Deterministic: same inputs always produce the same output.
   *   - Non-invertible: output does not reveal the key or seeds (SHA-256 pre-image resistance).
   *   - Streamable: AES-CTR is block-aligned; different `bytesNeeded` values
   *     produce prefixes of the same infinite stream for the same seeds.
   */
  generateBytes(options: DeterministicBytesOptions): Buffer {
    const { key, bytesNeeded, providerAddress = "", size = bytesNeeded } = options;

    this.validateOptions(options);

    const derivedKey = this.deriveKey(providerAddress, size, key);
    const bytes = this.extractKeystream(derivedKey, bytesNeeded);

    return bytes;
  }

  /**
   * Returns a Readable stream of deterministic pseudo-random bytes.
   */
  generateBytesStream(options: DeterministicBytesOptions): Readable {
    const { key, bytesNeeded, providerAddress = "", size = bytesNeeded } = options;

    this.validateOptions({ ...options, bytesNeeded: 1 }); // Just validate basic options

    const derivedKey = this.deriveKey(providerAddress, size, key);
    const staticIV = Buffer.alloc(AES_IV_LENGTH, 0);
    const cipher = crypto.createCipheriv("aes-256-ctr", derivedKey, staticIV);

    let remaining = bytesNeeded;
    const CHUNK_SIZE = 64 * 1024; // 64 KB chunks

    return new Readable({
      read() {
        if (remaining <= 0) {
          this.push(null);
          return;
        }

        const toRead = Math.min(remaining, CHUNK_SIZE);
        const zeroes = Buffer.alloc(toRead, 0);
        const chunk = cipher.update(zeroes);
        remaining -= toRead;

        this.push(chunk);

        if (remaining <= 0) {
          const final = cipher.final();
          if (final.length > 0) {
            this.push(final);
          }
          this.push(null);
        }
      },
    });
  }

  private validateOptions(options: DeterministicBytesOptions): void {
    const { key, bytesNeeded } = options;

    if (!key || typeof key !== "string" || key.trim().length === 0) {
      throw new Error("DeterministicRandom: `key` must be a non-empty string.");
    }

    if (!Number.isInteger(bytesNeeded) || bytesNeeded <= 0) {
      throw new Error("DeterministicRandom: `bytesNeeded` must be a positive integer.");
    }

    if (bytesNeeded > MAX_BYTES) {
      throw new Error(
        `DeterministicRandom: \`bytesNeeded\` exceeds maximum allowed size of ${MAX_BYTES} bytes. ` +
          `Split large requests into chunks.`,
      );
    }

    const { size = 0 } = options;
    if (!Number.isInteger(size) || size < 0) {
      throw new Error("DeterministicRandom: `size` must be a non-negative integer.");
    }
  }

  private deriveKey(providerAddress: string, size: number, key: string): Buffer {
    // Encode `size` as a fixed-width big-endian uint64 so that
    // size=1 and size=10 produce distinct keys (no string-concat ambiguity).
    const sizeBuffer = Buffer.alloc(UINT64_BUFFER_LENGTH);
    sizeBuffer.writeBigUInt64BE(BigInt(size));

    const seedPayload = Buffer.concat([Buffer.from(providerAddress, "utf8"), sizeBuffer, Buffer.from(key, "utf8")]);

    return crypto.createHash("sha256").update(seedPayload).digest();
  }

  private extractKeystream(derivedKey: Buffer, bytesNeeded: number): Buffer {
    if (derivedKey.length !== AES_KEY_LENGTH) {
      // Defensive — SHA-256 always returns 32 bytes; guard against future refactors.
      throw new Error(`DeterministicRandom: derived key must be ${AES_KEY_LENGTH} bytes.`);
    }

    // Static IV is intentional here: the key is freshly derived per input set,
    // so IV reuse across different calls does not compromise security.
    const staticIV = Buffer.alloc(AES_IV_LENGTH, 0);
    const cipher = crypto.createCipheriv("aes-256-ctr", derivedKey, staticIV);

    // Encrypting zeroes extracts the raw AES-CTR keystream — our random output.
    const zeroes = Buffer.alloc(bytesNeeded, 0);
    return cipher.update(zeroes);
  }
}
