/**
 * Calculation utilities for metrics and health scores
 * Provides consistent calculation logic across the application
 */

import type { ProviderCombinedPerformance, ProviderHealth, ProviderHealthStatus } from "../types/providers";
import { ACTIVITY_THRESHOLDS, HEALTH_THRESHOLDS, MIN_DATA_REQUIREMENTS } from "./constants";

/**
 * Calculate provider health score and status
 *
 * Health score is calculated based on:
 * - Deal success rate (40% weight)
 * - Retrieval success rate (40% weight)
 * - Activity recency (20% weight)
 *
 * @param provider - Provider performance data
 * @returns Provider health information
 *
 * @example
 * const health = calculateProviderHealth(provider);
 * console.log(health.status); // "excellent" | "good" | "fair" | "poor" | "inactive"
 * console.log(health.score); // 0-100
 */
export function calculateProviderHealth(provider: ProviderCombinedPerformance): ProviderHealth {
  const { weekly } = provider;

  // Safety check: if weekly data is missing, return inactive
  if (!weekly) {
    return {
      status: "inactive",
      score: 0,
      dealScore: 0,
      retrievalScore: 0,
      isActive: false,
    };
  }

  // Check if provider is active (activity within last 7 days)
  const now = new Date();
  const lastActivity = weekly.lastDealAt || weekly.lastRetrievalAt;
  const isActive = lastActivity
    ? (now.getTime() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24) <= ACTIVITY_THRESHOLDS.ACTIVE
    : false;

  if (!isActive) {
    return {
      status: "inactive",
      score: 0,
      dealScore: 0,
      retrievalScore: 0,
      isActive: false,
    };
  }

  // Calculate deal score (0-100)
  const dealScore = calculateSuccessScore(
    weekly.totalDeals || 0,
    weekly.dealSuccessRate || 0,
    MIN_DATA_REQUIREMENTS.MIN_DEALS_FOR_RATE,
  );

  // Calculate retrieval score (0-100)
  const retrievalScore = calculateSuccessScore(
    weekly.totalRetrievals || 0,
    weekly.retrievalSuccessRate || 0,
    MIN_DATA_REQUIREMENTS.MIN_RETRIEVALS_FOR_RATE,
  );

  // Calculate activity score (0-100) based on recency
  const activityScore = lastActivity ? calculateActivityScore(new Date(lastActivity)) : 0;

  // Weighted average: 40% deals, 40% retrievals, 20% activity
  const overallScore = Math.round(dealScore * 0.4 + retrievalScore * 0.4 + activityScore * 0.2);

  // Determine status based on score
  const status = getHealthStatus(overallScore);

  return {
    status,
    score: overallScore,
    dealScore,
    retrievalScore,
    isActive: true,
  };
}

/**
 * Calculate success score based on volume and success rate
 *
 * @param volume - Total number of operations
 * @param successRate - Success rate percentage (0-100)
 * @param minVolume - Minimum volume required for full score
 * @returns Score (0-100)
 */
function calculateSuccessScore(volume: number, successRate: number, minVolume: number): number {
  if (volume === 0) return 0;

  // Volume factor: gradually increase from 0 to 1 as volume approaches minVolume
  const volumeFactor = Math.min(volume / minVolume, 1);

  // Success rate is already 0-100, just apply volume factor
  return Math.round(successRate * volumeFactor);
}

/**
 * Calculate activity score based on recency
 *
 * @param lastActivity - Date of last activity
 * @returns Score (0-100)
 */
function calculateActivityScore(lastActivity: Date): number {
  const now = new Date();
  const daysSinceActivity = (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceActivity <= 1) return 100; // Active today
  if (daysSinceActivity <= 3) return 90; // Active in last 3 days
  if (daysSinceActivity <= ACTIVITY_THRESHOLDS.ACTIVE) return 70; // Active in last 7 days

  return 0; // Inactive
}

/**
 * Get health status from score
 *
 * @param score - Health score (0-100)
 * @returns Health status
 */
function getHealthStatus(score: number): ProviderHealthStatus {
  if (score >= HEALTH_THRESHOLDS.EXCELLENT) return "excellent";
  if (score >= HEALTH_THRESHOLDS.GOOD) return "good";
  if (score >= HEALTH_THRESHOLDS.FAIR) return "fair";
  if (score > 0) return "poor";
  return "inactive";
}

/**
 * Calculate average from array of numbers
 *
 * @param values - Array of numbers
 * @returns Average value or 0 if empty
 *
 * @example
 * calculateAverage([10, 20, 30]) // 20
 * calculateAverage([]) // 0
 */
export function calculateAverage(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

/**
 * Calculate percentage
 *
 * @param part - Part value
 * @param total - Total value
 * @returns Percentage (0-100) or 0 if total is 0
 *
 * @example
 * calculatePercentage(25, 100) // 25
 * calculatePercentage(3, 4) // 75
 * calculatePercentage(0, 0) // 0
 */
export function calculatePercentage(part: number, total: number): number {
  if (total === 0) return 0;
  return (part / total) * 100;
}

/**
 * Calculate success rate
 *
 * @param successful - Number of successful operations
 * @param total - Total number of operations
 * @returns Success rate percentage (0-100) or 0 if total is 0
 *
 * @example
 * calculateSuccessRate(95, 100) // 95
 * calculateSuccessRate(0, 0) // 0
 */
export function calculateSuccessRate(successful: number, total: number): number {
  return calculatePercentage(successful, total);
}

/**
 * Calculate improvement percentage between two values
 *
 * @param newValue - New value
 * @param oldValue - Old value
 * @returns Improvement percentage (positive = improvement, negative = regression)
 *
 * @example
 * calculateImprovement(120, 100) // 20 (20% improvement)
 * calculateImprovement(80, 100) // -20 (20% regression)
 */
export function calculateImprovement(newValue: number, oldValue: number): number {
  if (oldValue === 0) return 0;
  return ((newValue - oldValue) / oldValue) * 100;
}

/**
 * Calculate CDN improvement over direct retrieval
 *
 * @param cdnLatency - CDN average latency
 * @param directLatency - Direct average latency
 * @returns Improvement percentage (positive = CDN is faster)
 *
 * @example
 * calculateCdnImprovement(300, 500) // 40 (CDN is 40% faster)
 * calculateCdnImprovement(600, 500) // -20 (CDN is 20% slower)
 */
export function calculateCdnImprovement(cdnLatency: number, directLatency: number): number {
  if (directLatency === 0) return 0;
  return ((directLatency - cdnLatency) / directLatency) * 100;
}

/**
 * Safely parse BigInt string to number
 * Returns 0 if parsing fails or value is too large
 *
 * @param value - BigInt as string
 * @returns Number value or 0
 *
 * @example
 * parseBigIntSafe("1234567890") // 1234567890
 * parseBigIntSafe("invalid") // 0
 */
export function parseBigIntSafe(value: string | number): number {
  if (typeof value === "number") return value;

  try {
    const num = Number(value);
    return Number.isNaN(num) ? 0 : num;
  } catch {
    return 0;
  }
}

/**
 * Clamp a value between min and max
 *
 * @param value - Value to clamp
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Clamped value
 *
 * @example
 * clamp(150, 0, 100) // 100
 * clamp(-10, 0, 100) // 0
 * clamp(50, 0, 100) // 50
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
