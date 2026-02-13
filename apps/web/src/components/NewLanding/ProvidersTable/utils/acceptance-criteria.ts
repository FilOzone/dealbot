export const ACCEPTANCE_CRITERIA = {
  MIN_STORAGE_SAMPLES: 200,
  MIN_RETRIEVAL_SAMPLES: 200,
  MIN_RETENTION_SAMPLES: 500,
  MIN_SUCCESS_RATE: 97.0,
  MAX_FAULT_RATE: 0.2,
} as const;

export type CriteriaStatus = "success" | "warning" | "insufficient";

export function getSuccessRateStatus(successRate: number, samples: number): CriteriaStatus {
  if (samples < ACCEPTANCE_CRITERIA.MIN_STORAGE_SAMPLES) {
    return "insufficient";
  }
  return successRate >= ACCEPTANCE_CRITERIA.MIN_SUCCESS_RATE ? "success" : "warning";
}

export function getFaultRateStatus(faultRate: number, samples: number): CriteriaStatus {
  if (samples < ACCEPTANCE_CRITERIA.MIN_RETENTION_SAMPLES) {
    return "insufficient";
  }
  return faultRate <= ACCEPTANCE_CRITERIA.MAX_FAULT_RATE ? "success" : "warning";
}

export function getSamplesStatus(samples: number, minSamples: number): CriteriaStatus {
  return samples >= minSamples ? "success" : "insufficient";
}
