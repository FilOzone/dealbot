/**
 * Decoded provider info
 */
export interface ServiceProduct {
  type: "PDP";
  isActive: boolean;
  capabilities: Record<string, string>; // Object map of capability key-value pairs
  data: PDPOffering;
}

/**
 * PDP offering details (decoded from capability k/v pairs)
 */
export interface PDPOffering {
  serviceURL: string | null;
  minPieceSizeInBytes: bigint;
  maxPieceSizeInBytes: bigint;
  ipniPiece: boolean;
  ipniIpfs: boolean;
  storagePricePerTibPerDay: bigint;
  minProvingPeriodInEpochs: bigint;
  location: string;
  paymentTokenAddress: `0x${string}`;
}

/**
 * Provider Details
 */
export interface Provider {
  address: string;
  providerId?: string | null;
  name: string;
  description: string;
  payee: string;
  serviceUrl: string | null;
  isActive: boolean;
  isApproved: boolean;
  region: string;
  metadata?: ServiceProduct | {};
  createdAt: string;
  updatedAt: string;
}

/**
 * Provider list response with pagination without metrics
 */
export interface ProvidersListResponseWithoutMetrics {
  providers: Provider[];
  total: number;
  offset: number;
  count: number;
  limit: number;
}
