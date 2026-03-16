import { Clock, Database, Network } from "lucide-react";
import type { DealbotConfigDto } from "@/types/config";

interface InfrastructureInfoProps {
  config: DealbotConfigDto;
}

function InfrastructureInfo({ config }: InfrastructureInfoProps) {
  const formatRate = (perHour: number): string => {
    if (perHour >= 1) {
      return `${perHour}/hour`;
    }
    const perDay = perHour * 24;
    if (perDay >= 1) {
      return `${perDay.toFixed(1)}/day`;
    }
    const perWeek = perDay * 7;
    return `${perWeek.toFixed(1)}/week`;
  };

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {/* Network */}
      <div className="flex items-start gap-3 p-4 rounded-lg border bg-card">
        <div className="mt-0.5 p-2 rounded-md bg-primary/10">
          <Network className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-muted-foreground">Network</p>
          <p className="text-lg font-semibold mt-1 capitalize">{config.network}</p>
        </div>
      </div>

      {/* Deal Frequency */}
      <div className="flex items-start gap-3 p-4 rounded-lg border bg-card">
        <div className="mt-0.5 p-2 rounded-md bg-blue-500/10">
          <Clock className="h-4 w-4 text-blue-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-muted-foreground">Deal Creation</p>
          <p className="text-lg font-semibold mt-1">{formatRate(config.jobs.dealsPerSpPerHour)} per SP</p>
        </div>
      </div>

      {/* Retrieval Frequency */}
      <div className="flex items-start gap-3 p-4 rounded-lg border bg-card">
        <div className="mt-0.5 p-2 rounded-md bg-green-500/10">
          <Database className="h-4 w-4 text-green-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-muted-foreground">Retrieval Tests</p>
          <p className="text-lg font-semibold mt-1">{formatRate(config.jobs.retrievalsPerSpPerHour)} per SP</p>
        </div>
      </div>
    </div>
  );
}

export default InfrastructureInfo;
