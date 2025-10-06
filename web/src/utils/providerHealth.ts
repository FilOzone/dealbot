import type { ProviderPerformanceDto } from "../types/stats";

export type HealthStatus = "excellent" | "good" | "warning" | "critical" | "inactive";

export interface HealthCriteria {
  status: HealthStatus;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: string;
  reasons: string[];
  score: number;
}

const THRESHOLDS = {
  EXCELLENT: 95,
  GOOD: 90,
  WARNING: 85,
  CRITICAL: 80,
  MIN_DEALS_FOR_7D: 5,
  DEGRADATION_THRESHOLD: 10,
  INACTIVE_DAYS: 7,
};

/**
 * Calculate comprehensive provider health status based on multiple criteria
 */
export function calculateProviderHealth(provider: ProviderPerformanceDto): HealthCriteria {
  const reasons: string[] = [];
  let status: HealthStatus = "good";
  let score = 100;

  // Check if provider is inactive
  const daysSinceLastDeal = provider.lastDealTime
    ? Math.floor((Date.now() - new Date(provider.lastDealTime).getTime()) / (1000 * 60 * 60 * 24))
    : Infinity;

  if (!provider.isActive || daysSinceLastDeal > THRESHOLDS.INACTIVE_DAYS) {
    return {
      status: "inactive",
      label: "Inactive",
      color: "text-gray-500",
      bgColor: "bg-gray-50",
      borderColor: "border-gray-300",
      icon: "⚪",
      reasons: ["Provider is marked inactive or has not processed deals recently"],
      score: 0,
    };
  }

  // Primary criteria: 7-day success rates (most important for current performance)
  const avg7dRate = (provider.dealSuccessRate7d + provider.retrievalSuccessRate7d) / 2;

  if (avg7dRate >= THRESHOLDS.EXCELLENT) {
    status = "excellent";
    reasons.push(`Excellent 7-day performance (${avg7dRate.toFixed(1)}%)`);
  } else if (avg7dRate >= THRESHOLDS.GOOD) {
    status = "good";
    score -= 5;
    reasons.push(`Good 7-day performance (${avg7dRate.toFixed(1)}%)`);
  } else if (avg7dRate >= THRESHOLDS.WARNING) {
    status = "warning";
    score -= 20;
    reasons.push(`Below optimal 7-day success rate (${avg7dRate.toFixed(1)}%)`);
  } else if (avg7dRate >= THRESHOLDS.CRITICAL) {
    status = "critical";
    score -= 40;
    reasons.push(`Poor 7-day success rate (${avg7dRate.toFixed(1)}%)`);
  } else {
    status = "critical";
    score -= 50;
    reasons.push(`Critical: Very low 7-day success rate (${avg7dRate.toFixed(1)}%)`);
  }

  // Check for degradation: 7-day vs all-time
  const avgAllTimeRate = (provider.dealSuccessRate + provider.retrievalSuccessRate) / 2;
  const degradation = avgAllTimeRate - avg7dRate;

  if (degradation > THRESHOLDS.DEGRADATION_THRESHOLD) {
    if (status !== "critical") {
      status = "warning";
    }
    score -= 15;
    reasons.push(`Performance degrading: ${degradation.toFixed(1)}% drop from all-time average`);
  } else if (degradation < -5) {
    // Performance improving
    reasons.push(`Performance improving: ${Math.abs(degradation).toFixed(1)}% above all-time average`);
    score += 5;
  }

  // Check individual metrics
  if (provider.dealSuccessRate7d < THRESHOLDS.WARNING) {
    score -= 10;
    reasons.push(`Low deal success rate (${provider.dealSuccessRate7d.toFixed(1)}%)`);
  }

  if (provider.retrievalSuccessRate7d < THRESHOLDS.WARNING) {
    score -= 10;
    reasons.push(`Low retrieval success rate (${provider.retrievalSuccessRate7d.toFixed(1)}%)`);
  }

  // Check for stale metrics
  if (provider.last7dMetricsUpdate) {
    const hoursSinceUpdate = Math.floor(
      (Date.now() - new Date(provider.last7dMetricsUpdate).getTime()) / (1000 * 60 * 60),
    );
    if (hoursSinceUpdate > 48) {
      reasons.push(`Metrics not updated recently (${Math.floor(hoursSinceUpdate / 24)} days ago)`);
    }
  }

  // Clamp score between 0 and 100
  score = Math.max(0, Math.min(100, score));

  // Define visual properties based on status - theme compatible
  const statusConfig: Record<HealthStatus, Omit<HealthCriteria, "reasons" | "score" | "status">> = {
    excellent: {
      label: "Excellent",
      color: "text-green-600 dark:text-green-400",
      bgColor: "bg-green-50 dark:bg-green-950/30",
      borderColor: "border-green-200 dark:border-green-900",
      icon: "✅",
    },
    good: {
      label: "Good",
      color: "text-blue-600 dark:text-blue-400",
      bgColor: "bg-blue-50 dark:bg-blue-950/30",
      borderColor: "border-blue-200 dark:border-blue-900",
      icon: "👍",
    },
    warning: {
      label: "Needs Attention",
      color: "text-yellow-700 dark:text-yellow-400",
      bgColor: "bg-yellow-50 dark:bg-yellow-950/30",
      borderColor: "border-yellow-300 dark:border-yellow-800",
      icon: "⚠️",
    },
    critical: {
      label: "Underperforming",
      color: "text-red-600 dark:text-red-400",
      bgColor: "bg-red-50 dark:bg-red-950/30",
      borderColor: "border-red-200 dark:border-red-900",
      icon: "🔴",
    },
    inactive: {
      label: "Inactive",
      color: "text-muted-foreground",
      bgColor: "bg-muted/50",
      borderColor: "border-muted",
      icon: "⚪",
    },
  };

  return {
    status,
    ...statusConfig[status],
    reasons,
    score,
  };
}

/**
 * Sort providers by health status (worst first for attention)
 */
export function sortProvidersByHealth(
  providers: ProviderPerformanceDto[],
  order: "asc" | "desc" = "asc",
): ProviderPerformanceDto[] {
  const healthScores = new Map(providers.map((p) => [p.provider, calculateProviderHealth(p).score]));

  return [...providers].sort((a, b) => {
    const scoreA = healthScores.get(a.provider) || 0;
    const scoreB = healthScores.get(b.provider) || 0;
    return order === "asc" ? scoreA - scoreB : scoreB - scoreA;
  });
}

/**
 * Filter providers by health status
 */
export function filterProvidersByHealth(
  providers: ProviderPerformanceDto[],
  statuses: HealthStatus[],
): ProviderPerformanceDto[] {
  return providers.filter((p) => statuses.includes(calculateProviderHealth(p).status));
}
