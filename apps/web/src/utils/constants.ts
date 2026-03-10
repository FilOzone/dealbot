/**
 * Application-wide constants
 * Centralized configuration values and magic numbers
 */

/**
 * Health score thresholds for provider status classification
 */
export const HEALTH_THRESHOLDS = {
  EXCELLENT: 90,
  GOOD: 75,
  FAIR: 50,
  POOR: 25,
} as const;

/**
 * Success rate thresholds for quality assessment
 */
export const SUCCESS_RATE_THRESHOLDS = {
  EXCELLENT: 95,
  GOOD: 85,
  ACCEPTABLE: 70,
  POOR: 50,
} as const;

/**
 * Latency thresholds in milliseconds
 */
export const LATENCY_THRESHOLDS = {
  EXCELLENT: 1000, // < 1s
  GOOD: 3000, // < 3s
  ACCEPTABLE: 5000, // < 5s
  POOR: 10000, // < 10s
} as const;

/**
 * Data size units in bytes
 */
export const DATA_UNITS = {
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
  TB: 1024 * 1024 * 1024 * 1024,
  PB: 1024 * 1024 * 1024 * 1024 * 1024,
} as const;

/**
 * Default pagination settings
 */
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

/**
 * Default date range settings (in days)
 */
export const DATE_RANGES = {
  LAST_7_DAYS: 7,
  LAST_30_DAYS: 30,
  LAST_90_DAYS: 90,
  MAX_RANGE: 365,
} as const;

/**
 * Chart colors for consistent visualization
 */
export const CHART_COLORS = {
  PRIMARY: "hsl(var(--primary))",
  SUCCESS: "hsl(142, 76%, 36%)",
  WARNING: "hsl(38, 92%, 50%)",
  ERROR: "hsl(0, 84%, 60%)",
  INFO: "hsl(199, 89%, 48%)",
  DIRECT_SP: "hsl(142, 76%, 36%)",
  IPFS_PIN: "hsl(38, 92%, 50%)",
} as const;

/**
 * Provider activity thresholds (in days)
 */
export const ACTIVITY_THRESHOLDS = {
  ACTIVE: 7, // Active if activity within 7 days
  INACTIVE: 30, // Inactive if no activity for 30 days
} as const;

/**
 * Minimum data requirements for calculations
 */
export const MIN_DATA_REQUIREMENTS = {
  MIN_DEALS_FOR_RATE: 10,
  MIN_RETRIEVALS_FOR_RATE: 10,
  MIN_SAMPLES_FOR_AVERAGE: 3,
} as const;

/**
 * Number formatting options
 */
export const NUMBER_FORMAT = {
  MAX_DECIMALS: 2,
  PERCENTAGE_DECIMALS: 1,
  LARGE_NUMBER_THRESHOLD: 10000,
} as const;
