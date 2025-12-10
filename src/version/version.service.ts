import { Injectable } from "@nestjs/common";
import { loadVersionInfo } from "./version.utils.js";
import type { IVersionInfo } from "./version.types.js";

@Injectable()
export class VersionService {
  private versionInfo: IVersionInfo | null = null;

  constructor() {
    this.versionInfo = loadVersionInfo();
  }

  /**
   * Get version information
   */
  getVersionInfo(): IVersionInfo | null {
    return this.versionInfo;
  }
}
