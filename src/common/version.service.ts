import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";

export interface IVersionInfo {
  version: string;
  commit: string;
  commitShort: string;
  branch: string;
  buildTime: string;
}

@Injectable()
export class VersionService {
  private versionInfo: IVersionInfo | null = null;

  constructor() {
    this.loadVersionInfo();
  }

  /**
   * Load version information from version.json
   */
  private loadVersionInfo() {
    try {
      const versionPath = join(process.cwd(), "dist", "version.json");
      const versionData = readFileSync(versionPath, "utf-8");
      this.versionInfo = JSON.parse(versionData);
    } catch (error) {
      console.warn("Warning: Could not load version info:", error);
      this.versionInfo = {
        version: "unknown",
        commit: "unknown",
        commitShort: "unknown",
        branch: "unknown",
        buildTime: new Date().toISOString(),
      };
    }
  }

  /**
   * Get version information
   */
  getVersionInfo(): IVersionInfo | null {
    return this.versionInfo;
  }

  /**
   * Print version information to console
   */
  printVersionInfo(): void {
    if (!this.versionInfo) return;

    console.log("=".repeat(60));
    console.log("Dealbot Starting...");
    console.log(`Version: ${this.versionInfo.version}`);
    console.log(`Commit: ${this.versionInfo.commit} (${this.versionInfo.commitShort})`);
    console.log(`Branch: ${this.versionInfo.branch}`);
    console.log(`Build Time: ${this.versionInfo.buildTime}`);
    console.log("=".repeat(60));
  }
}
