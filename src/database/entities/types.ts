export enum DealStatus {
  PENDING = "pending",
  UPLOADED = "uploaded",
  PIECE_ADDED = "piece_added",
  DEAL_CREATED = "deal_created",
  FAILED = "failed",
}

export enum ServiceType {
  DIRECT_SP = "direct_sp",
  CDN = "cdn",
  IPFS_PIN = "ipfs_pin",
}

export enum RetrievalStatus {
  PENDING = "pending",
  IN_PROGRESS = "in_progress",
  SUCCESS = "success",
  FAILED = "failed",
  TIMEOUT = "timeout",
}
