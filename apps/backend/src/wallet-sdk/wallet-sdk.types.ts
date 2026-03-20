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
