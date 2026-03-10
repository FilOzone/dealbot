/**
 * Data transformation utilities
 * Transforms API data to component-friendly formats
 */

import type { DailyAggregatedMetrics } from "@/types/metrics";
import type { ProviderCombinedPerformance } from "@/types/providers";
import type { ServiceComparisonMetrics } from "@/types/services";

/**
 * Chart data point for time-series visualization
 */
export interface ChartDataPoint {
  date: string;
  [key: string]: string | number;
}

/**
 * Transform daily metrics to chart data format
 *
 * @param dailyMetrics - Array of daily aggregated metrics
 * @param metrics - Metrics to include in chart
 * @returns Array of chart data points
 *
 * @example
 * const chartData = transformDailyMetricsToChart(metrics, [
 *   { key: 'totalDeals', label: 'Total Deals' },
 *   { key: 'successfulDeals', label: 'Successful Deals' }
 * ]);
 */
export function transformDailyMetricsToChart(
  dailyMetrics: DailyAggregatedMetrics[],
  metrics: Array<{ key: keyof DailyAggregatedMetrics; label: string }>,
): ChartDataPoint[] {
  return dailyMetrics.map((day) => {
    const dataPoint: ChartDataPoint = { date: day.date };

    metrics.forEach(({ key, label }) => {
      const value = day[key];
      dataPoint[label] = typeof value === "string" ? Number(value) : value;
    });

    return dataPoint;
  });
}

/**
 * Transform service comparison to chart data format
 *
 * @param serviceMetrics - Array of service comparison metrics
 * @param metric - Metric to extract (e.g., 'totalRetrievals', 'successRate')
 * @returns Array of chart data points
 *
 * @example
 * const chartData = transformServiceComparisonToChart(metrics, 'totalRetrievals');
 * // Returns: [{ date: '2024-01-01', 'Direct SP': 150, 'IPFS Pin': 50 }, ...]
 */
export function transformServiceComparisonToChart(
  serviceMetrics: ServiceComparisonMetrics[],
  metric: keyof ServiceComparisonMetrics["directSp"],
): ChartDataPoint[] {
  return serviceMetrics.map((day) => ({
    date: day.date,
    "Direct SP": day.directSp[metric],
    "IPFS Pin": day.ipfsPin[metric],
  }));
}

/**
 * Transform providers to table data format
 *
 * @param providers - Array of provider performance data
 * @returns Array of table rows
 *
 * @example
 * const tableData = transformProvidersToTable(providers);
 */
export interface ProviderTableRow {
  spAddress: string;
  totalDeals: number;
  dealSuccessRate: number;
  totalRetrievals: number;
  retrievalSuccessRate: number;
  avgDealLatency: number;
  avgRetrievalLatency: number;
  lastActivity: string | undefined;
}

export function transformProvidersToTable(providers: ProviderCombinedPerformance[]): ProviderTableRow[] {
  return providers
    .filter((provider) => provider.weekly && provider.allTime)
    .map((provider) => {
      const lastDeal = provider.weekly!.lastDealAt;
      const lastRetrieval = provider.weekly!.lastRetrievalAt;
      const lastActivity =
        lastDeal && lastRetrieval ? (lastDeal > lastRetrieval ? lastDeal : lastRetrieval) : lastDeal || lastRetrieval;

      return {
        spAddress: provider.weekly!.spAddress,
        totalDeals: provider.weekly!.totalDeals,
        dealSuccessRate: provider.weekly!.dealSuccessRate,
        totalRetrievals: provider.weekly!.totalRetrievals,
        retrievalSuccessRate: provider.weekly!.retrievalSuccessRate,
        avgDealLatency: provider.weekly!.avgDealLatencyMs,
        avgRetrievalLatency: provider.weekly!.avgRetrievalLatencyMs,
        lastActivity: lastActivity instanceof Date ? lastActivity.toISOString() : lastActivity,
      };
    });
}

/**
 * Group daily metrics by provider
 *
 * @param dailyMetrics - Array of daily metrics with provider info
 * @returns Map of provider address to their daily metrics
 *
 * @example
 * const grouped = groupMetricsByProvider(metrics);
 * const providerMetrics = grouped.get('f01234');
 */
export function groupMetricsByProvider<T extends { spAddress?: string }>(dailyMetrics: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  dailyMetrics.forEach((metric) => {
    if (!metric.spAddress) return;

    const existing = grouped.get(metric.spAddress) || [];
    grouped.set(metric.spAddress, [...existing, metric]);
  });

  return grouped;
}

/**
 * Calculate date range from daily metrics
 *
 * @param dailyMetrics - Array of daily metrics
 * @returns Date range object
 *
 * @example
 * const range = calculateDateRange(metrics);
 * console.log(range); // { startDate: '2024-01-01', endDate: '2024-01-31', days: 31 }
 */
export interface DateRange {
  startDate: string;
  endDate: string;
  days: number;
}

export function calculateDateRange(dailyMetrics: Array<{ date: string }>): DateRange | null {
  if (dailyMetrics.length === 0) return null;

  const dates = dailyMetrics.map((m) => m.date).sort();
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];

  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  return { startDate, endDate, days };
}

/**
 * Fill missing dates in time series data
 *
 * @param data - Array of data points with dates
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @param defaultValue - Default value for missing dates
 * @returns Array with all dates filled
 *
 * @example
 * const filled = fillMissingDates(data, '2024-01-01', '2024-01-31', { value: 0 });
 */
export function fillMissingDates<T extends { date: string }>(
  data: T[],
  startDate: string,
  endDate: string,
  defaultValue: Omit<T, "date">,
): T[] {
  const result: T[] = [];
  const dataMap = new Map(data.map((item) => [item.date, item]));

  const start = new Date(startDate);
  const end = new Date(endDate);
  const current = new Date(start);

  while (current <= end) {
    const dateStr = current.toISOString().split("T")[0];
    const existing = dataMap.get(dateStr);

    if (existing) {
      result.push(existing);
    } else {
      result.push({ ...defaultValue, date: dateStr } as T);
    }

    current.setDate(current.getDate() + 1);
  }

  return result;
}

/**
 * Aggregate metrics by time period (week, month)
 *
 * @param dailyMetrics - Array of daily metrics
 * @param period - Aggregation period ('week' | 'month')
 * @returns Aggregated metrics
 *
 * @example
 * const weekly = aggregateByPeriod(dailyMetrics, 'week');
 */
export type AggregationPeriod = "week" | "month";

export interface AggregatedPeriod {
  period: string; // ISO week (YYYY-Www) or month (YYYY-MM)
  startDate: string;
  endDate: string;
  totalDeals: number;
  totalRetrievals: number;
  avgSuccessRate: number;
}

export function aggregateByPeriod(
  dailyMetrics: DailyAggregatedMetrics[],
  period: AggregationPeriod,
): AggregatedPeriod[] {
  const groups = new Map<string, DailyAggregatedMetrics[]>();

  dailyMetrics.forEach((metric) => {
    const date = new Date(metric.date);
    let key: string;

    if (period === "week") {
      // ISO week format: YYYY-Www
      const year = date.getFullYear();
      const week = getISOWeek(date);
      key = `${year}-W${week.toString().padStart(2, "0")}`;
    } else {
      // Month format: YYYY-MM
      key = metric.date.substring(0, 7);
    }

    const existing = groups.get(key) || [];
    groups.set(key, [...existing, metric]);
  });

  return Array.from(groups.entries()).map(([periodKey, metrics]) => {
    const dates = metrics.map((m) => m.date).sort();
    const totalDeals = metrics.reduce((sum, m) => sum + m.totalDeals, 0);
    const totalRetrievals = metrics.reduce((sum, m) => sum + m.totalRetrievals, 0);
    const avgSuccessRate =
      metrics.reduce((sum, m) => sum + (m.dealSuccessRate + m.retrievalSuccessRate) / 2, 0) / metrics.length;

    return {
      period: periodKey,
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      totalDeals,
      totalRetrievals,
      avgSuccessRate,
    };
  });
}

/**
 * Get ISO week number for a date
 *
 * @param date - Date object
 * @returns ISO week number (1-53)
 */
function getISOWeek(date: Date): number {
  const target = new Date(date.valueOf());
  const dayNumber = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNumber + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}
