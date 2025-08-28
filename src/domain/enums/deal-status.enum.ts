export enum DealStatus {
  PENDING = "PENDING",
  UPLOADED = "UPLOADED",
  PIECE_ADDED = "PIECE_ADDED",
  DEAL_CREATED = "DEAL_CREATED",
  FAILED = "FAILED",
}

export enum DealType {
  WITH_CDN = "WITH_CDN",
  WITHOUT_CDN = "WITHOUT_CDN",
}

export enum RetrievalStatus {
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
  TIMEOUT = "TIMEOUT",
}
