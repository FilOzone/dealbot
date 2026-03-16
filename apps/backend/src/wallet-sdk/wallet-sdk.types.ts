import type { PaymentsService } from "@filoz/synapse-sdk/payments";
import type { WarmStorageService } from "@filoz/synapse-sdk/warm-storage";
import type { PDPProvider } from "filecoin-pin";

export interface WalletServices {
  paymentsService: PaymentsService;
  warmStorageService: WarmStorageService;
}

export interface PDPProviderEx extends PDPProvider {
  isApproved: boolean;
}

export interface AccountInfo {
  funds: bigint;
  [key: string]: any;
}

export interface StorageCheck {
  rate: {
    perEpoch: bigint;
    perMonth: bigint;
    [key: string]: any;
  };
  depositNeeded: bigint;
  needsFwssMaxApproval: boolean;
  ready: boolean;
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
  rateAllowance: string;
  lockupAllowance: string;
  durationMonths: number;
}
