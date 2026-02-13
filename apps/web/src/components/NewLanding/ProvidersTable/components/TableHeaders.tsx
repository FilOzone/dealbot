import { ACCEPTANCE_CRITERIA } from "../utils/acceptance-criteria";

export function StorageSuccessRateHeader() {
  return (
    <div className="text-right whitespace-normal leading-tight">
      Data Storage
      <br />
      Success Rate
    </div>
  );
}

export function StorageSamplesHeader() {
  return (
    <div className="text-right whitespace-normal leading-tight">
      Storage
      <br />
      Samples
      <div className="text-xs font-normal text-muted-foreground normal-case">
        (Min {ACCEPTANCE_CRITERIA.MIN_STORAGE_SAMPLES})
      </div>
    </div>
  );
}

export function DataRetentionFaultRateHeader() {
  return (
    <div className="text-right whitespace-normal leading-tight">
      Data Retention
      <br />
      Fault Rate
    </div>
  );
}

export function DataRetentionSamplesHeader() {
  return (
    <div className="text-right whitespace-normal leading-tight">
      Data Retention
      <br />
      Samples
      <div className="text-xs font-normal text-muted-foreground normal-case">
        (Min {ACCEPTANCE_CRITERIA.MIN_RETENTION_SAMPLES})
      </div>
    </div>
  );
}

export function RetrievalSuccessRateHeader() {
  return (
    <div className="text-right whitespace-normal leading-tight">
      Retrieval
      <br />
      Success Rate
    </div>
  );
}

export function RetrievalSamplesHeader() {
  return (
    <div className="text-right whitespace-normal leading-tight">
      Retrieval
      <br />
      Samples
      <div className="text-xs font-normal text-muted-foreground normal-case">
        (Min {ACCEPTANCE_CRITERIA.MIN_RETRIEVAL_SAMPLES})
      </div>
    </div>
  );
}
