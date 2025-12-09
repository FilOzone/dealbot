#!/usr/bin/env node
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

/**
 * Get git commit hash
 * Priority: ENV variable > git command > 'unknown'
 */
function getGitCommit() {
  if (process.env.GIT_COMMIT) {
    return process.env.GIT_COMMIT;
  }
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch (error) {
    console.warn("Warning: Could not get git commit hash:", error.message);
    return "unknown";
  }
}

/**
 * Get short git commit hash (first 7 characters)
 * Priority: ENV variable > git command > 'unknown'
 */
function getGitCommitShort() {
  if (process.env.GIT_COMMIT_SHORT) {
    return process.env.GIT_COMMIT_SHORT;
  }
  try {
    return execSync("git rev-parse --short=7 HEAD", { encoding: "utf-8" }).trim();
  } catch (error) {
    console.warn("Warning: Could not get short git commit hash:", error.message);
    return "unknown";
  }
}

/**
 * Get git branch name
 * Priority: ENV variable > git command > 'unknown'
 */
function getGitBranch() {
  if (process.env.GIT_BRANCH) {
    return process.env.GIT_BRANCH;
  }
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
  } catch (error) {
    console.warn("Warning: Could not get git branch:", error.message);
    return "unknown";
  }
}

/**
 * Get version from package.json
 */
function getVersion() {
  try {
    const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
    return packageJson.version;
  } catch (error) {
    console.error("Error reading package.json:", error.message);
    return "0.0.0";
  }
}

/**
 * Generate version information
 */
function generateVersionInfo() {
  const version = getVersion();
  const commit = getGitCommit();
  const commitShort = getGitCommitShort();
  const branch = getGitBranch();
  const buildTime = new Date().toISOString();

  return {
    version,
    commit,
    commitShort,
    branch,
    buildTime,
  };
}

/**
 * Main function
 */
function main() {
  console.log("Generating version information...");

  const versionInfo = generateVersionInfo();

  console.log("Version info:", versionInfo);

  // Write version info for backend
  const backendVersionPath = join(rootDir, "src", "version.json");
  const backendDir = dirname(backendVersionPath);
  mkdirSync(backendDir, { recursive: true });
  writeFileSync(backendVersionPath, JSON.stringify(versionInfo, null, 2), "utf-8");
  console.log(`✓ Backend version file created: ${backendVersionPath}`);

  // Write version info for frontend
  const frontendVersionPath = join(rootDir, "web", "src", "version.json");
  const frontendDir = dirname(frontendVersionPath);
  mkdirSync(frontendDir, { recursive: true });
  writeFileSync(frontendVersionPath, JSON.stringify(versionInfo, null, 2), "utf-8");
  console.log(`✓ Frontend version file created: ${frontendVersionPath}`);

  console.log("Version generation completed!");
}

main();
