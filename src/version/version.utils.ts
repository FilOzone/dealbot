import { readFileSync } from "node:fs";
import { VERSION_FILE_PATH } from "./version.constants.js";
import type { IVersionInfo } from "./version.types.js";

/**
 * Load version information from version.json
 * Shared utility to avoid code duplication
 */
export function loadVersionInfo(): IVersionInfo {
  try {
    const versionData = readFileSync(VERSION_FILE_PATH, "utf-8");
    return JSON.parse(versionData) as IVersionInfo;
  } catch (error) {
    console.warn("Warning: Could not load version info:", error);
    return {
      version: "unknown",
      commit: "unknown",
      commitShort: "unknown",
      branch: "unknown",
      buildTime: new Date().toISOString(),
    };
  }
}
