/**
 * Time Window Parser Utility
 *
 * Parses flexible time window strings like "1h", "2.5d", "30d", "all"
 * into start/end dates with validation and security checks.
 */

export interface TimeWindow {
  startDate: Date;
  endDate: Date;
  days: number;
  preset: string;
  isAllTime: boolean;
}

export interface ParsedDuration {
  value: number;
  unit: "h" | "d";
  hours: number;
}

/**
 * Parse duration string (e.g., "1h", "2.5d", "30d")
 *
 * Supported formats:
 * - Hours: "1h", "1.5h", "12h", "24h"
 * - Days: "1d", "2.5d", "7d", "30d", "90d"
 * - Special: "all"
 *
 * @throws {Error} If format is invalid or out of bounds
 */
export function parseDuration(preset: string): ParsedDuration {
  // Normalize input
  const normalized = preset.trim().toLowerCase();

  // Special case: "all" time
  if (normalized === "all") {
    throw new Error('Use isAllTime flag for "all" preset');
  }

  // Regex pattern: optional digits, optional decimal, required unit
  // Examples: "1h", "1.5h", "2d", "2.5d"
  const pattern = /^(\d+(?:\.\d+)?)(h|d)$/;
  const match = normalized.match(pattern);

  if (!match) {
    throw new Error(
      `Invalid time window format: "${preset}". Expected format: <number><unit> (e.g., "1h", "2.5d", "30d")`,
    );
  }

  const [, valueStr, unit] = match;
  const value = Number.parseFloat(valueStr);

  // Validate number
  if (Number.isNaN(value) || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid duration value: "${valueStr}". Must be a positive number.`);
  }

  // Convert to hours
  let hours: number;
  if (unit === "h") {
    hours = value;
  } else if (unit === "d") {
    hours = value * 24;
  } else {
    throw new Error(`Invalid unit: "${unit}". Supported units: h (hours), d (days)`);
  }

  // Validate bounds
  const MIN_HOURS = 1;
  const MAX_HOURS = 90 * 24; // 90 days

  if (hours < MIN_HOURS) {
    throw new Error(`Duration too short: ${hours}h. Minimum is ${MIN_HOURS} hour.`);
  }

  if (hours > MAX_HOURS) {
    throw new Error(`Duration too long: ${hours}h (${hours / 24}d). Maximum is ${MAX_HOURS / 24} days.`);
  }

  return {
    value,
    unit: unit as "h" | "d",
    hours,
  };
}

/**
 * Calculate time window from preset duration
 *
 * @param preset - Duration string (e.g., "1h", "2.5d", "30d") or "all"
 * @param referenceDate - Reference date (defaults to now)
 * @returns TimeWindow object with start/end dates
 */
export function calculateTimeWindow(preset: string, referenceDate: Date = new Date()): TimeWindow {
  const normalized = preset.trim().toLowerCase();

  // Handle "all" time special case
  if (normalized === "all") {
    return {
      startDate: new Date(0), // Unix epoch (will be handled specially in queries)
      endDate: referenceDate,
      days: -1, // Sentinel value for "all time"
      preset: "all",
      isAllTime: true,
    };
  }

  // Parse duration
  const duration = parseDuration(preset);

  // Calculate start date by subtracting hours
  const startDate = new Date(referenceDate);
  startDate.setHours(startDate.getHours() - duration.hours);

  // Calculate days (for display purposes)
  const days = Math.round((duration.hours / 24) * 10) / 10; // Round to 1 decimal

  return {
    startDate,
    endDate: referenceDate,
    days,
    preset: normalized,
    isAllTime: false,
  };
}

/**
 * Validate custom date range
 *
 * @param startDate - Start date
 * @param endDate - End date
 * @throws {Error} If date range is invalid
 */
export function validateDateRange(startDate: Date, endDate: Date): void {
  // Check if dates are valid
  if (Number.isNaN(startDate.getTime())) {
    throw new Error("Invalid start date");
  }

  if (Number.isNaN(endDate.getTime())) {
    throw new Error("Invalid end date");
  }

  // Check if start is before end
  if (startDate >= endDate) {
    throw new Error("Start date must be before end date");
  }

  // Check if end date is in the future
  const now = new Date();
  if (endDate > now) {
    throw new Error("End date cannot be in the future");
  }

  // Check maximum range (90 days)
  const MAX_DAYS = 90;
  const daysDiff = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);

  if (daysDiff > MAX_DAYS) {
    throw new Error(`Date range too large: ${Math.round(daysDiff)} days. Maximum is ${MAX_DAYS} days.`);
  }

  // Check minimum range (1 hour)
  const MIN_HOURS = 1;
  const hoursDiff = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);

  if (hoursDiff < MIN_HOURS) {
    throw new Error(`Date range too small: ${hoursDiff.toFixed(1)} hours. Minimum is ${MIN_HOURS} hour.`);
  }
}

/**
 * Parse custom date range from strings
 *
 * @param startDateStr - Start date string (YYYY-MM-DD)
 * @param endDateStr - End date string (YYYY-MM-DD)
 * @returns TimeWindow object
 */
export function parseCustomDateRange(startDateStr: string, endDateStr: string): TimeWindow {
  // Parse dates
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);

  // Set end date to end of day (23:59:59.999)
  endDate.setHours(23, 59, 59, 999);

  // Validate
  validateDateRange(startDate, endDate);

  // Calculate days
  const days = Math.round(((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) * 10) / 10;

  return {
    startDate,
    endDate,
    days,
    preset: `${startDateStr}_${endDateStr}`,
    isAllTime: false,
  };
}

/**
 * Sanitize preset string to prevent injection attacks
 *
 * @param preset - User-provided preset string
 * @returns Sanitized preset string
 */
export function sanitizePreset(preset: string): string {
  // Remove any non-alphanumeric characters except . and -
  return preset.replace(/[^a-zA-Z0-9.-]/g, "");
}

/**
 * Get common preset suggestions for UI
 */
export const COMMON_PRESETS = [
  { value: "1h", label: "Last Hour" },
  { value: "6h", label: "Last 6 Hours" },
  { value: "12h", label: "Last 12 Hours" },
  { value: "24h", label: "Last 24 Hours" },
  { value: "2d", label: "Last 2 Days" },
  { value: "7d", label: "Last 7 Days" },
  { value: "14d", label: "Last 14 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "60d", label: "Last 60 Days" },
  { value: "90d", label: "Last 90 Days" },
  { value: "all", label: "All Time" },
] as const;
