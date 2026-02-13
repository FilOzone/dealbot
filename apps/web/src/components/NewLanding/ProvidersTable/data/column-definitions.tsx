import { createColumnHelper } from "@tanstack/react-table";
import type { ProviderWindowMetrics } from "@/schamas/providersWindowMetrics";
import {
  ApprovalBadge,
  DataRetentionFaultRateHeader,
  DataRetentionSamplesHeader,
  FaultRateCell,
  RetrievalSamplesHeader,
  RetrievalSuccessRateHeader,
  SamplesCell,
  StorageSamplesHeader,
  StorageSuccessRateHeader,
  SuccessRateCell,
} from "../components";
import {
  ACCEPTANCE_CRITERIA,
  getFaultRateStatus,
  getSamplesStatus,
  getSuccessRateStatus,
} from "../utils/acceptance-criteria";

const columnHelper = createColumnHelper<ProviderWindowMetrics>();

export const columns = [
  columnHelper.accessor("providerId", {
    header: "Provider",
    cell: (info) => (
      <div className="flex items-center gap-2">
        <span className="font-normal">{info.getValue()}</span>
        <ApprovalBadge approved={info.row.original.manuallyApproved} />
      </div>
    ),
  }),
  columnHelper.accessor("storageSuccessRate", {
    header: StorageSuccessRateHeader,
    size: 110,
    cell: (info) => {
      const rate = info.getValue();
      const samples = info.row.original.storageSamples;
      const status = getSuccessRateStatus(rate, samples);
      return <SuccessRateCell rate={rate} status={status} />;
    },
  }),

  columnHelper.accessor("storageSamples", {
    header: StorageSamplesHeader,
    size: 100,
    cell: (info) => {
      const samples = info.getValue();
      const status = getSamplesStatus(samples, ACCEPTANCE_CRITERIA.MIN_STORAGE_SAMPLES);
      return (
        <div className="text-right">
          <SamplesCell samples={samples} status={status} />
        </div>
      );
    },
  }),
  columnHelper.accessor("dataRetentionFaultRate", {
    header: DataRetentionFaultRateHeader,
    size: 110,
    cell: (info) => {
      const rate = info.getValue();
      const samples = info.row.original.dataRetentionSamples;
      const status = getFaultRateStatus(rate, samples);
      return <FaultRateCell rate={rate} status={status} />;
    },
  }),
  columnHelper.accessor("dataRetentionSamples", {
    header: DataRetentionSamplesHeader,
    size: 110,
    cell: (info) => {
      const samples = info.getValue();
      const status = getSamplesStatus(samples, ACCEPTANCE_CRITERIA.MIN_RETENTION_SAMPLES);
      return (
        <div className="text-right">
          <SamplesCell samples={samples} status={status} />
        </div>
      );
    },
  }),
  columnHelper.accessor("retrievalSuccessRate", {
    header: RetrievalSuccessRateHeader,
    size: 110,
    cell: (info) => {
      const rate = info.getValue();
      const samples = info.row.original.retrievalSamples;
      const status = getSuccessRateStatus(rate, samples);
      return <SuccessRateCell rate={rate} status={status} />;
    },
  }),
  columnHelper.accessor("retrievalSamples", {
    header: RetrievalSamplesHeader,
    size: 100,
    cell: (info) => {
      const samples = info.getValue();
      const status = getSamplesStatus(samples, ACCEPTANCE_CRITERIA.MIN_RETRIEVAL_SAMPLES);
      return (
        <div className="text-right">
          <SamplesCell samples={samples} status={status} />
        </div>
      );
    },
  }),
];
