/**
 * Validation utilities for data and user input
 * Provides consistent validation logic across the application
 */

import { DATE_RANGES, MIN_DATA_REQUIREMENTS } from "./constants";

/**
 * Validate date string format (YYYY-MM-DD)
 *
 * @param dateStr - Date string to validate
 * @returns True if valid, false otherwise
 *
 * @example
 * isValidDateString('2024-01-15') // true
 * isValidDateString('2024-1-15') // false
 * isValidDateString('invalid') // false
 */
export function isValidDateString(dateStr: string): boolean {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) return false;

  const date = new Date(dateStr);
  return !Number.isNaN(date.getTime());
}

/**
 * Validate date range
 *
 * @param startDate - Start date string (YYYY-MM-DD)
 * @param endDate - End date string (YYYY-MM-DD)
 * @param maxDays - Maximum allowed days in range
 * @returns Validation result with error message if invalid
 *
 * @example
 * const result = validateDateRange('2024-01-01', '2024-01-31', 90);
 * if (!result.valid) console.error(result.error);
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateDateRange(
  startDate: string,
  endDate: string,
  maxDays: number = DATE_RANGES.MAX_RANGE,
): ValidationResult {
  if (!isValidDateString(startDate)) {
    return { valid: false, error: "Invalid start date format. Use YYYY-MM-DD." };
  }

  if (!isValidDateString(endDate)) {
    return { valid: false, error: "Invalid end date format. Use YYYY-MM-DD." };
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (start > end) {
    return { valid: false, error: "Start date must be before or equal to end date." };
  }

  const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  if (daysDiff > maxDays) {
    return { valid: false, error: `Date range cannot exceed ${maxDays} days.` };
  }

  return { valid: true };
}

/**
 * Validate storage provider address format
 *
 * @param address - Provider address to validate
 * @returns True if valid, false otherwise
 *
 * @example
 * isValidProviderAddress('f01234') // true
 * isValidProviderAddress('t01234') // true
 * isValidProviderAddress('invalid') // false
 */
export function isValidProviderAddress(address: string): boolean {
  // Filecoin address format: f0... or t0... followed by digits
  const addressRegex = /^[ft]0\d+$/;
  return addressRegex.test(address);
}

/**
 * Check if data is sufficient for calculations
 *
 * @param count - Number of data points
 * @param minRequired - Minimum required data points
 * @returns True if sufficient, false otherwise
 *
 * @example
 * hasSufficientData(15, MIN_DATA_REQUIREMENTS.MIN_DEALS_FOR_RATE) // true
 * hasSufficientData(5, MIN_DATA_REQUIREMENTS.MIN_DEALS_FOR_RATE) // false
 */
export function hasSufficientData(count: number, minRequired: number): boolean {
  return count >= minRequired;
}

/**
 * Check if success rate is reliable based on sample size
 *
 * @param total - Total number of operations
 * @param minRequired - Minimum required for reliability
 * @returns True if reliable, false otherwise
 *
 * @example
 * isSuccessRateReliable(50, MIN_DATA_REQUIREMENTS.MIN_DEALS_FOR_RATE) // true
 * isSuccessRateReliable(5, MIN_DATA_REQUIREMENTS.MIN_DEALS_FOR_RATE) // false
 */
export function isSuccessRateReliable(
  total: number,
  minRequired: number = MIN_DATA_REQUIREMENTS.MIN_DEALS_FOR_RATE,
): boolean {
  return hasSufficientData(total, minRequired);
}

/**
 * Validate pagination parameters
 *
 * @param page - Page number
 * @param limit - Items per page
 * @returns Validation result
 *
 * @example
 * const result = validatePagination(1, 20);
 * if (!result.valid) console.error(result.error);
 */
export function validatePagination(page: number, limit: number): ValidationResult {
  if (!Number.isInteger(page) || page < 1) {
    return { valid: false, error: "Page must be a positive integer." };
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return { valid: false, error: "Limit must be between 1 and 100." };
  }

  return { valid: true };
}

/**
 * Sanitize search query string
 *
 * @param query - Search query to sanitize
 * @param maxLength - Maximum allowed length
 * @returns Sanitized query string
 *
 * @example
 * sanitizeSearchQuery('  hello world  ', 50) // "hello world"
 * sanitizeSearchQuery('<script>alert("xss")</script>') // "scriptalert(xss)/script"
 */
export function sanitizeSearchQuery(query: string, maxLength: number = 100): string {
  return query
    .trim()
    .replace(/[<>]/g, "") // Remove potential HTML tags
    .substring(0, maxLength);
}

/**
 * Check if value is a valid number
 *
 * @param value - Value to check
 * @returns True if valid number, false otherwise
 *
 * @example
 * isValidNumber(123) // true
 * isValidNumber('123') // false
 * isValidNumber(NaN) // false
 * isValidNumber(Infinity) // false
 */
export function isValidNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Check if value is a valid percentage (0-100)
 *
 * @param value - Value to check
 * @returns True if valid percentage, false otherwise
 *
 * @example
 * isValidPercentage(50) // true
 * isValidPercentage(150) // false
 * isValidPercentage(-10) // false
 */
export function isValidPercentage(value: number): boolean {
  return isValidNumber(value) && value >= 0 && value <= 100;
}

/**
 * Check if array has items
 *
 * @param array - Array to check
 * @returns True if array has items, false otherwise
 *
 * @example
 * hasItems([1, 2, 3]) // true
 * hasItems([]) // false
 * hasItems(null) // false
 */
export function hasItems<T>(array: T[] | null | undefined): array is T[] {
  return Array.isArray(array) && array.length > 0;
}

/**
 * Check if object has all required keys
 *
 * @param obj - Object to check
 * @param keys - Required keys
 * @returns True if all keys exist, false otherwise
 *
 * @example
 * hasRequiredKeys({ a: 1, b: 2 }, ['a', 'b']) // true
 * hasRequiredKeys({ a: 1 }, ['a', 'b']) // false
 */
export function hasRequiredKeys<T extends object>(obj: T, keys: (keyof T)[]): boolean {
  return keys.every((key) => key in obj);
}

/**
 * Check if value is within range
 *
 * @param value - Value to check
 * @param min - Minimum value (inclusive)
 * @param max - Maximum value (inclusive)
 * @returns True if within range, false otherwise
 *
 * @example
 * isInRange(50, 0, 100) // true
 * isInRange(150, 0, 100) // false
 */
export function isInRange(value: number, min: number, max: number): boolean {
  return isValidNumber(value) && value >= min && value <= max;
}
