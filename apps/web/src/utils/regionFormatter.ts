/**
 * Region formatting utilities
 * Handles parsing and formatting of region strings from various formats
 */

/**
 * Parsed region components
 */
interface ParsedRegion {
  country?: string;
  state?: string;
  locality?: string;
  organization?: string;
  organizationalUnit?: string;
  commonName?: string;
}

/**
 * Parse X.500 Distinguished Name (DN) format region string
 * Format: C=GB;ST=Gloucestershire;L=Cheltenham
 *
 * Common DN components:
 * - C: Country
 * - ST: State/Province
 * - L: Locality/City
 * - O: Organization
 * - OU: Organizational Unit
 * - CN: Common Name
 *
 * @param region - Region string in DN format
 * @returns Parsed region components
 */
function parseDNFormat(region: string): ParsedRegion {
  const parsed: ParsedRegion = {};

  // Split by semicolon or comma (both are valid DN separators)
  const parts = region.split(/[;,]/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Split by = sign
    const [key, ...valueParts] = trimmed.split("=");
    if (!key || valueParts.length === 0) continue;

    const value = valueParts.join("=").trim(); // Rejoin in case value contains =
    if (!value) continue;

    const normalizedKey = key.trim().toUpperCase();

    switch (normalizedKey) {
      case "C":
      case "COUNTRY":
        parsed.country = value;
        break;
      case "ST":
      case "STATE":
      case "PROVINCE":
        parsed.state = value;
        break;
      case "L":
      case "LOCALITY":
      case "CITY":
        parsed.locality = value;
        break;
      case "O":
      case "ORGANIZATION":
        parsed.organization = value;
        break;
      case "OU":
      case "ORGANIZATIONALUNIT":
        parsed.organizationalUnit = value;
        break;
      case "CN":
      case "COMMONNAME":
        parsed.commonName = value;
        break;
    }
  }

  return parsed;
}

/**
 * Parse JSON format region string
 * Format: {"country":"GB","state":"Gloucestershire","city":"Cheltenham"}
 *
 * @param region - Region string in JSON format
 * @returns Parsed region components
 */
function parseJSONFormat(region: string): ParsedRegion {
  try {
    const json = JSON.parse(region);

    return {
      country: json.country || json.c || json.C,
      state: json.state || json.province || json.st || json.ST,
      locality: json.locality || json.city || json.l || json.L,
      organization: json.organization || json.o || json.O,
      organizationalUnit: json.organizationalUnit || json.ou || json.OU,
      commonName: json.commonName || json.cn || json.CN,
    };
  } catch {
    return {};
  }
}

/**
 * Parse comma-separated format
 * Format: "Cheltenham, Gloucestershire, GB" or "GB, Gloucestershire, Cheltenham"
 *
 * @param region - Region string in comma-separated format
 * @returns Parsed region components
 */
function parseCommaSeparated(region: string): ParsedRegion {
  const parts = region
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) return {};

  // Try to detect country code (2-letter uppercase)
  const countryIndex = parts.findIndex((p) => /^[A-Z]{2}$/.test(p));

  if (countryIndex !== -1) {
    const country = parts[countryIndex];
    const remaining = parts.filter((_, i) => i !== countryIndex);

    // Assume: [locality, state] or [state, locality]
    if (remaining.length === 2) {
      // If first item looks like a city (shorter), assume [locality, state]
      if (remaining[0].length < remaining[1].length) {
        return { country, locality: remaining[0], state: remaining[1] };
      }
      // Otherwise assume [state, locality]
      return { country, state: remaining[0], locality: remaining[1] };
    }

    if (remaining.length === 1) {
      return { country, locality: remaining[0] };
    }

    return { country };
  }

  // No country code found, assume order: [locality, state, country]
  if (parts.length === 3) {
    return { locality: parts[0], state: parts[1], country: parts[2] };
  }

  if (parts.length === 2) {
    return { locality: parts[0], state: parts[1] };
  }

  return { locality: parts[0] };
}

/**
 * Parse region string from any supported format
 *
 * @param region - Region string in any format
 * @returns Parsed region components
 */
function parseRegion(region: string | null | undefined): ParsedRegion {
  if (!region || typeof region !== "string") {
    return {};
  }

  const trimmed = region.trim();
  if (!trimmed) {
    return {};
  }

  // Try JSON format first
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const parsed = parseJSONFormat(trimmed);
    if (Object.keys(parsed).length > 0) {
      return parsed;
    }
  }

  // Try DN format (contains = sign)
  if (trimmed.includes("=")) {
    const parsed = parseDNFormat(trimmed);
    if (Object.keys(parsed).length > 0) {
      return parsed;
    }
  }

  // Try comma-separated format
  if (trimmed.includes(",")) {
    const parsed = parseCommaSeparated(trimmed);
    if (Object.keys(parsed).length > 0) {
      return parsed;
    }
  }

  // Fallback: treat entire string as locality
  return { locality: trimmed };
}

/**
 * Format parsed region into human-readable string
 * Priority: Locality > State > Country
 *
 * @param parsed - Parsed region components
 * @returns Formatted region string
 */
function formatParsedRegion(parsed: ParsedRegion): string {
  const parts: string[] = [];

  // Prioritize locality (city)
  if (parsed.locality) {
    parts.push(parsed.locality);
  }

  // Add state if available
  if (parsed.state) {
    parts.push(parsed.state);
  }

  // Add country if available
  if (parsed.country) {
    parts.push(parsed.country);
  }

  // Fallback to organization or common name if no location info
  if (parts.length === 0) {
    if (parsed.organization) {
      parts.push(parsed.organization);
    } else if (parsed.commonName) {
      parts.push(parsed.commonName);
    } else if (parsed.organizationalUnit) {
      parts.push(parsed.organizationalUnit);
    }
  }

  return parts.length > 0 ? parts.join(", ") : "Unknown";
}

/**
 * Format region string into human-readable format
 * Handles multiple input formats:
 * - X.500 DN format: "C=GB;ST=Gloucestershire;L=Cheltenham"
 * - JSON format: '{"country":"GB","state":"Gloucestershire","city":"Cheltenham"}'
 * - Comma-separated: "Cheltenham, Gloucestershire, GB"
 * - Plain text: "London"
 *
 * @param region - Region string in any format
 * @returns Formatted region string (e.g., "Cheltenham, Gloucestershire, GB")
 *
 * @example
 * formatRegion("C=GB;ST=Gloucestershire;L=Cheltenham")
 * // Returns: "Cheltenham, Gloucestershire, GB"
 *
 * @example
 * formatRegion('{"country":"US","state":"California","city":"San Francisco"}')
 * // Returns: "San Francisco, California, US"
 *
 * @example
 * formatRegion("London, UK")
 * // Returns: "London, UK"
 *
 * @example
 * formatRegion(null)
 * // Returns: "Unknown"
 */
export function formatRegion(region: string | null | undefined): string {
  const parsed = parseRegion(region);
  return formatParsedRegion(parsed);
}

/**
 * Get short region representation (locality or country only)
 * Useful for compact displays
 *
 * @param region - Region string in any format
 * @returns Short region string (e.g., "Cheltenham" or "GB")
 *
 * @example
 * getShortRegion("C=GB;ST=Gloucestershire;L=Cheltenham")
 * // Returns: "Cheltenham"
 *
 * @example
 * getShortRegion("C=GB")
 * // Returns: "GB"
 */
export function getShortRegion(region: string | null | undefined): string {
  const parsed = parseRegion(region);

  if (parsed.locality) return parsed.locality;
  if (parsed.state) return parsed.state;
  if (parsed.country) return parsed.country;
  if (parsed.organization) return parsed.organization;
  if (parsed.commonName) return parsed.commonName;

  return "Unknown";
}

/**
 * Get country code from region string
 *
 * @param region - Region string in any format
 * @returns Country code (e.g., "GB") or null if not found
 *
 * @example
 * getCountryCode("C=GB;ST=Gloucestershire;L=Cheltenham")
 * // Returns: "GB"
 */
export function getCountryCode(region: string | null | undefined): string | null {
  const parsed = parseRegion(region);
  return parsed.country || null;
}

/**
 * Check if region string is valid and parseable
 *
 * @param region - Region string to validate
 * @returns True if region can be parsed, false otherwise
 */
export function isValidRegion(region: string | null | undefined): boolean {
  if (!region || typeof region !== "string") {
    return false;
  }

  const parsed = parseRegion(region);
  return Object.keys(parsed).length > 0;
}
