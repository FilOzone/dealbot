/**
 * Parses Curio version string into a readable format
 * @param versionString - Format: "version+network+git_hash_timestamp+timezone"
 *                        Example: "1.27.0+calibnet+git_76330a87_2025-10-31T17:35:30+01:00"
 * @returns Formatted version string like "1.27.0 (76330a87)" or just "1.27.0" if no git info
 */
export function parseCurioVersion(versionString: string): string {
  if (!versionString || typeof versionString !== "string") {
    return "";
  }

  const trimmed = versionString.trim();
  if (!trimmed) {
    return "";
  }

  const parts = trimmed.split("+");
  const version = parts[0];

  if (parts.length < 3) {
    return version;
  }

  const gitInfo = parts.slice(2).join("+");

  if (gitInfo.startsWith("git_")) {
    const gitParts = gitInfo.split("_");
    if (gitParts.length >= 2 && gitParts[1]) {
      const hash = gitParts[1].trim();
      if (hash) {
        return `${version} (${hash})`;
      }
    }
  }

  // Fallback: just return version
  return version;
}
