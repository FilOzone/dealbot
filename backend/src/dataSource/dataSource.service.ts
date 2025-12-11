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
      return { name: dataset.titleNullable, data: Buffer.from(data), size: data.byteLength };
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
}
