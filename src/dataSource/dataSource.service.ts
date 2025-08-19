import { ConfigService } from "@nestjs/config";
import { Injectable, Logger } from "@nestjs/common";
import { DataFile } from "../domain/interfaces/external-services.interface";
import * as fs from "fs";
import * as path from "path";
import { IAppConfig } from "../config/app.config";
import { DEFAULT_LOCAL_DATASETS_PATH } from "../common/constants";

@Injectable()
export class DataSourceService {
  private readonly logger: Logger;

  constructor(private readonly configService: ConfigService<IAppConfig>) {
    this.logger = new Logger(DataSourceService.name);
  }

  async fetchLocalDataset(count: number, maxSize: number): Promise<DataFile[]> {
    this.logger.log(`Fetching ${count} local datasets with max size ${maxSize}`);
    const files: DataFile[] = [];

    try {
      const datasetsPath =
        this.configService.get("dealbot", { infer: true })?.localDatasetsPath || DEFAULT_LOCAL_DATASETS_PATH;
      const fileNames = await fs.promises.readdir(datasetsPath);

      for (let i = 0; i < count; i++) {
        const randomIndex = Math.floor(Math.random() * fileNames.length);
        const file = fileNames[randomIndex];
        const filePath = path.join(datasetsPath, file);
        const fileStat = await fs.promises.stat(filePath);
        if (fileStat.isFile()) {
          const fileData = await fs.promises.readFile(filePath);
          files.push({
            name: file,
            data: fileData,
            size: fileData.length,
            contentType: "application/octet-stream",
            source: "LOCAL",
          });
        }
      }
    } catch (error) {
      this.logger.error("Failed to fetch local dataset", error);
      throw error;
    }

    return files;
  }

  async fetchFlickrImages(count: number, maxSize: number): Promise<DataFile[]> {
    this.logger.log(`Fetching ${count} Flickr images with max size ${maxSize}`);
    const files: DataFile[] = [];

    try {
      // For development, generate sample image data
      for (let i = 0; i < count; i++) {
        const imageData = await this.generateSampleImage(i, maxSize);
        files.push({
          name: `flickr_image_${Date.now()}_${i}.jpg`,
          data: imageData,
          size: imageData.length,
          contentType: "image/jpeg",
          source: "FLICKR",
        });
      }
    } catch (error) {
      this.logger.error("Failed to fetch Flickr images", error);
      throw error;
    }

    return files;
  }

  private async generateSampleImage(seed: number, maxSize: number): Promise<Buffer> {
    // Generate a simple placeholder image
    const size = Math.min(Math.floor(Math.random() * maxSize * 0.8) + maxSize * 0.2, maxSize);

    // Create a simple binary data that represents an image
    const buffer = Buffer.alloc(size);
    for (let i = 0; i < size; i++) {
      buffer[i] = (seed + i) % 256;
    }

    return buffer;
  }
}
