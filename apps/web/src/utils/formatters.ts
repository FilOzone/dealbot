/**
 * Formatting utilities for numbers, dates, bytes, and percentages
 * Provides consistent formatting across the application
 */

import { DATA_UNITS, NUMBER_FORMAT } from "./constants";

/**
 * Format a number with thousand separators
 *
 * @param value - Number to format
 * @param decimals - Number of decimal places (default: 0)
 * @returns Formatted number string
 *
 * @example
 * formatNumber(1234567) // "1,234,567"
 * formatNumber(1234.5678, 2) // "1,234.57"
 */
export function formatNumber(value: number, decimals: number = 0): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a large number with K/M/B suffixes
 *
 * @param value - Number to format
 * @returns Formatted number string with suffix
 *
 * @example
 * formatCompactNumber(1234) // "1.2K"
 * formatCompactNumber(1234567) // "1.2M"
 * formatCompactNumber(1234567890) // "1.2B"
 */
export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= NUMBER_FORMAT.LARGE_NUMBER_THRESHOLD) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return formatNumber(value);
}

/**
 * Format bytes to human-readable size
 *
 * @param bytes - Byte count (can be string for BigInt values)
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted size string with unit
 *
 * @example
 * formatBytes(1024) // "1.00 KB"
 * formatBytes("1073741824") // "1.00 GB"
 * formatBytes(1536, 1) // "1.5 KB"
 */
export function formatBytes(bytes: number | string, decimals: number = 2): string {
  const numBytes = typeof bytes === "string" ? Number(bytes) : bytes;

  if (numBytes === 0) return "0 Bytes";
  if (Number.isNaN(numBytes)) return "Invalid";

  if (numBytes >= DATA_UNITS.PB) {
    return `${(numBytes / DATA_UNITS.PB).toFixed(decimals)} PB`;
  }
  if (numBytes >= DATA_UNITS.TB) {
    return `${(numBytes / DATA_UNITS.TB).toFixed(decimals)} TB`;
  }
  if (numBytes >= DATA_UNITS.GB) {
    return `${(numBytes / DATA_UNITS.GB).toFixed(decimals)} GB`;
  }
  if (numBytes >= DATA_UNITS.MB) {
    return `${(numBytes / DATA_UNITS.MB).toFixed(decimals)} MB`;
  }
  if (numBytes >= DATA_UNITS.KB) {
    return `${(numBytes / DATA_UNITS.KB).toFixed(decimals)} KB`;
  }

  return `${numBytes} Bytes`;
}

/**
 * Format a percentage value
 *
 * @param value - Percentage value (0-100)
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted percentage string
 *
 * @example
 * formatPercentage(95.5) // "95.5%"
 * formatPercentage(100) // "100.0%"
 * formatPercentage(0) // "0.0%"
 */
export function formatPercentage(value: number, decimals: number = NUMBER_FORMAT.PERCENTAGE_DECIMALS): string {
  return `${Number(value).toFixed(decimals)}%`;
}

/**
 * Format milliseconds to human-readable duration
 *
 * @param ms - Milliseconds
 * @returns Formatted duration string
 *
 * @example
 * formatDuration(1500) // "1.5s"
 * formatDuration(65000) // "1m 5s"
 * formatDuration(3665000) // "1h 1m"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Format a date to ISO date string (YYYY-MM-DD)
 *
 * @param date - Date object or ISO string
 * @returns Formatted date string
 *
 * @example
 * formatDate(new Date('2024-01-15')) // "2024-01-15"
 * formatDate('2024-01-15T10:30:00Z') // "2024-01-15"
 */
export function formatDate(date: Date | string): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  return dateObj.toISOString().split("T")[0];
}

/**
 * Format a date to human-readable format
 *
 * @param date - Date object or ISO string
 * @returns Formatted date string
 *
 * @example
 * formatDateLong(new Date('2024-01-15')) // "Jan 15, 2024"
 */
export function formatDateLong(date: Date | string): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  return dateObj.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Format a date to relative time (e.g., "2 hours ago")
 *
 * @param date - Date object or ISO string
 * @returns Relative time string
 *
 * @example
 * formatRelativeTime(new Date(Date.now() - 3600000)) // "1 hour ago"
 * formatRelativeTime(new Date(Date.now() - 86400000)) // "1 day ago"
 */
export function formatRelativeTime(date: Date | string): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
  }
  if (diffHours > 0) {
    return diffHours === 1 ? "1 hour ago" : `${diffHours} hours ago`;
  }
  if (diffMinutes > 0) {
    return diffMinutes === 1 ? "1 minute ago" : `${diffMinutes} minutes ago`;
  }
  if (diffSeconds > 0) {
    return diffSeconds === 1 ? "1 second ago" : `${diffSeconds} seconds ago`;
  }

  return "just now";
}

/**
 * Format a storage provider address (shorten if too long)
 *
 * @param address - Provider address
 * @param maxLength - Maximum length before truncation (default: 20)
 * @returns Formatted address
 *
 * @example
 * formatProviderAddress('f01234567890123456789') // "f012345...56789"
 * formatProviderAddress('f01234') // "f01234"
 */
export function formatProviderAddress(address: string, maxLength: number = 20): string {
  if (address.length <= maxLength) {
    return address;
  }

  const prefixLength = Math.floor((maxLength - 3) / 2);
  const suffixLength = maxLength - 3 - prefixLength;

  return `${address.slice(0, prefixLength)}...${address.slice(-suffixLength)}`;
}
