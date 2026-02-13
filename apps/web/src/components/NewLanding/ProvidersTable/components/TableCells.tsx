import { cn } from "@/lib/utils";
import type { CriteriaStatus } from "../utils/acceptance-criteria";

const rateStatusStyles: Record<CriteriaStatus, string> = {
  success: "text-green-600 font-medium",
  warning: "text-red-600 font-medium",
  insufficient: "text-gray-400",
};

const samplesStatusStyles: Record<CriteriaStatus, string> = {
  success: "text-foreground",
  warning: "text-orange-500",
  insufficient: "text-gray-400",
};

interface SuccessRateCellProps {
  rate: number;
  status: CriteriaStatus;
}

export function SuccessRateCell({ rate, status }: SuccessRateCellProps) {
  return <div className={`${cn(rateStatusStyles[status])} text-right`}>{rate.toFixed(1)}%</div>;
}

interface FaultRateCellProps {
  rate: number;
  status: CriteriaStatus;
}

export function FaultRateCell({ rate, status }: FaultRateCellProps) {
  return <div className={cn([rateStatusStyles[status], "text-right"])}>{rate.toFixed(2)}%</div>;
}

interface SamplesCellProps {
  samples: number;
  status: CriteriaStatus;
}

export function SamplesCell({ samples, status }: SamplesCellProps) {
  return <span className={cn(samplesStatusStyles[status])}>{samples.toLocaleString()}</span>;
}
