import { Network } from "../common/types.js";

export type CheckType = "dataStorage" | "retrieval" | "dataRetention" | "dataSetCreation";
export type ProviderStatus = "approved" | "unapproved";

export type CheckMetricLabels = {
  checkType: CheckType;
  providerId: string;
  providerName: string;
  providerStatus: ProviderStatus;
  network: Network;
};

export type CheckMetricLabelInput = {
  checkType: CheckType;
  network: Network;
  providerId?: bigint | null;
  providerName?: string | null;
  providerIsApproved?: boolean | null;
};

export const buildCheckMetricLabels = ({
  checkType,
  network,
  providerId,
  providerName,
  providerIsApproved,
}: CheckMetricLabelInput): CheckMetricLabels => {
  const normalizedProviderId = providerId != null ? String(providerId) : "unknown";
  const providerStatus: ProviderStatus = providerIsApproved ? "approved" : "unapproved";

  return {
    checkType,
    network,
    providerId: normalizedProviderId,
    providerName: providerName ?? "unknown",
    providerStatus,
  };
};

export function classifyFailureStatus(error: unknown): "failure.timedout" | "failure.other" {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /timeout|timed out/i.test(message) ? "failure.timedout" : "failure.other";
}
