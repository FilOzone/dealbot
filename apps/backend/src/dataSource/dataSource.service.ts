import * as crypto from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as path from "path";
import { KAGGLE_BASE_URL } from "../common/constants.js";
import type { DataFile } from "../common/types.js";
import type { IConfig, IDatasetConfig } from "../config/app.config.js";
import type { IKaggleDataset } from "./types.js";

@Injectable()
export class DataSourceService {
  private readonly kaggleDatasetsTotalPages: number;
  private readonly logger: Logger;

  constructor(private readonly configService: ConfigService<IConfig, true>) {
    this.kaggleDatasetsTotalPages = this.configService.get<IDatasetConfig>("dataset").totalPages;
    this.logger = new Logger(DataSourceService.name);
  }

  async fetchLocalDataset(minSize: number, maxSize: number): Promise<DataFile> {
    this.logger.log(`Fetching local dataset with min size ${minSize} and max size ${maxSize}`);

    try {
      const datasetsPath = this.configService.get<IDatasetConfig>("dataset").localDatasetsPath;
      const fileNames = await fs.promises.readdir(datasetsPath);

      const randomIndex = Math.floor(Math.random() * fileNames.length);
      const fileName = fileNames[randomIndex];
      const filePath = path.join(datasetsPath, fileName);
      const fileStat = await fs.promises.stat(filePath);
      if (fileStat.isFile()) {
        const fileData = await fs.promises.readFile(filePath);
        return { name: fileName, data: fileData, size: fileStat.size };
      }

      throw new Error("File isn't a Regular File");
    } catch (error) {
      this.logger.error("Failed to fetch local dataset", error);
      throw error;
    }
  }

  async fetchKaggleDataset(minSize: number, maxSize: number): Promise<DataFile> {
    this.logger.log(`Fetching kaggle dataset with min size ${minSize} and max size ${maxSize}`);

    try {
      const randomPage = Math.floor(Math.random() * this.kaggleDatasetsTotalPages);
      const datasetList = await this.fetchKaggleDatasetList(randomPage, minSize, maxSize);
      const randomIndex = Math.floor(Math.random() * datasetList.length);
      const dataset = datasetList[randomIndex];
      const downloadUrl = this.constructKaggleDatesetDownloadUrl(dataset);
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.arrayBuffer();
      return {
        name: dataset.titleNullable,
        data: Buffer.from(data),
        size: data.byteLength,
      };
    } catch (error) {
      this.logger.error("Failed to fetch kaggle dataset", error);
      throw error;
    }
  }

  private async fetchKaggleDatasetList(page: number, minSize: number, maxSize: number): Promise<IKaggleDataset[]> {
    try {
      const response = await fetch(this.constructKaggleDatasetListUrl(page, minSize, maxSize));

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      this.logger.error("Failed to fetch kaggle dataset list", error);
      throw error;
    }
  }

  private constructKaggleDatasetListUrl(page: number, minSize: number, maxSize: number): string {
    return `${KAGGLE_BASE_URL.replace(/\/$/, "")}/datasets/list?page=${page}&min_Size=${minSize}&max_Size=${maxSize}`;
  }

  private constructKaggleDatesetDownloadUrl(dataset: IKaggleDataset): string {
    const downloadBaseUrl = `${KAGGLE_BASE_URL.replace(/\/$/, "")}/datasets/download`;

    if (dataset.ref) return `${downloadBaseUrl}/${dataset.ref}`;

    if (dataset.hasUrl) {
      const parts = dataset.url.split("/");

      if (parts.length >= 2) {
        const ref = parts.splice(parts.length - 2, 2).join("/");
        return `${downloadBaseUrl}/${ref}`;
      }
    }

    if (dataset.urlNullable) {
      const parts = dataset.urlNullable.split("/");

      if (parts.length >= 2) {
        const ref = parts.splice(parts.length - 2, 2).join("/");
        return `${downloadBaseUrl}/${ref}`;
      }
    }

    throw new Error(`Failed to construct kaggle dataset download url for dataset ${dataset.ref}`);
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
      this.logger.error("Failed to generate random dataset", error);
      throw error;
    }
  }

  private async writeRandomDataStream(
    filePath: string,
    prefixBuffer: Buffer,
    randomDataSize: number,
    suffixBuffer: Buffer,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(filePath);
      const chunkSize = 1024 * 1024; // 1 MB chunks

      writeStream.on("error", (error) => {
        writeStream.close();
        reject(error);
      });

      writeStream.on("finish", () => {
        resolve();
      });

      // Write prefix
      writeStream.write(prefixBuffer);

      // Write random data in chunks
      let remainingBytes = randomDataSize;
      while (remainingBytes > 0) {
        const currentChunkSize = Math.min(chunkSize, remainingBytes);
        const chunk = crypto.randomBytes(currentChunkSize);
        writeStream.write(chunk);
        remainingBytes -= currentChunkSize;
      }

      // Write suffix and close
      writeStream.write(suffixBuffer);
      writeStream.end();
    });
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
        this.logger.warn(`Failed to cleanup random dataset ${fileName}`, error);
      }
    }
  }
}
