export interface ProviderData {
  providerId: string;
  manuallyApproved: boolean;
  storageSuccessRate: number;
  storageSamples: number;
  dataRetentionFaultRate: number;
  dataRetentionSamples: number;
  retrievalSuccessRate: number;
  retrievalSamples: number;
}
