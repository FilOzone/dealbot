export type CheckType = "dataStorage" | "retrieval";
export type ProviderStatus = "approved" | "unapproved";

export type CheckMetricLabels = {
  checkType: CheckType;
  providerId: string;
  providerStatus: ProviderStatus;
};

export type CheckMetricLabelInput = {
  checkType: CheckType;
  providerId?: number | null;
  providerIsApproved?: boolean | null;
};

export const buildCheckMetricLabels = ({
  checkType,
  providerId,
  providerIsApproved,
}: CheckMetricLabelInput): CheckMetricLabels => {
  const normalizedProviderId = providerId != null ? String(providerId) : "unknown";
  const providerStatus: ProviderStatus = providerIsApproved ? "approved" : "unapproved";

  return {
    checkType,
    providerId: normalizedProviderId,
    providerStatus,
  };
};
