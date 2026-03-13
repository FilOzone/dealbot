export type CheckType = "dataStorage" | "retrieval" | "dataRetention" | "dataSetCreation";
export type ProviderStatus = "approved" | "unapproved";

export type CheckMetricLabels = {
  checkType: CheckType;
  providerId: string;
  providerName: string;
  providerStatus: ProviderStatus;
};

export type CheckMetricLabelInput = {
  checkType: CheckType;
  providerId?: number | null;
  providerName?: string | null;
  providerIsApproved?: boolean | null;
};

export const buildCheckMetricLabels = ({
  checkType,
  providerId,
  providerName,
  providerIsApproved,
}: CheckMetricLabelInput): CheckMetricLabels => {
  const normalizedProviderId = providerId != null ? String(providerId) : "unknown";
  const providerStatus: ProviderStatus = providerIsApproved ? "approved" : "unapproved";

  return {
    checkType,
    providerId: normalizedProviderId,
    providerName: providerName ?? "unknown",
    providerStatus,
  };
};

export function classifyFailureStatus(error: unknown): "failure.timedout" | "failure.other" {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /timeout|timed out/i.test(message) ? "failure.timedout" : "failure.other";
}
