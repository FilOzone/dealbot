import type { PaymentsService, ProviderInfo, WarmStorageService } from "@filoz/synapse-sdk";

export interface WalletServices {
  paymentsService: PaymentsService;
  warmStorageService: WarmStorageService;
}

export interface ProviderInfoEx extends ProviderInfo {
  isApproved: boolean;
}

export interface AccountInfo {
  funds: bigint;
  [key: string]: any;
}

export interface StorageCheck {
  costs: {
    perMonth: bigint;
    [key: string]: any;
  };
  rateAllowanceNeeded: bigint;
  lockupAllowanceNeeded: bigint;
  [key: string]: any;
}

export interface ServiceApprovals {
  rateAllowance: bigint;
  lockupAllowance: bigint;
  [key: string]: any;
}

export interface StorageRequirements {
  accountInfo: AccountInfo;
  providerCount: number;
  storageCheck: StorageCheck;
  serviceApprovals: ServiceApprovals;
  datasetCreationFees: bigint;
  totalRequiredFunds: bigint;
  approvalDuration: bigint;
}

export interface WalletStatusLog {
  availableFunds: string;
  requiredMonthlyFunds: string;
  datasetCreationFees: string;
  totalRequired: string;
  providerCount: number;
}

export interface FundDepositLog {
  currentFunds: string;
  requiredFunds: string;
  depositAmount: string;
}

export interface TransactionLog {
  transactionHash: string;
  depositAmount?: string;
  serviceAddress?: string;
}

export interface ServiceApprovalLog {
  serviceAddress: string;
  rateAllowance: string;
  lockupAllowance: string;
  durationMonths: number;
}
