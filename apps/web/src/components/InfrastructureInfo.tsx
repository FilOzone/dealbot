import { Clock, Database, Network } from "lucide-react";
import { formatMilliseconds } from "@/utils/formatter";
import type { DealbotConfigDto } from "../types/config";

interface InfrastructureInfoProps {
  config: DealbotConfigDto;
}

export function InfrastructureInfo({ config }: InfrastructureInfoProps) {
  const networkDisplayName = config.network === "calibration" ? "Calibration Testnet" : "Mainnet";
  const dealInterval = formatMilliseconds(config.scheduling.dealIntervalSeconds * 1000);
  const retrievalInterval = formatMilliseconds(config.scheduling.retrievalIntervalSeconds * 1000);

  return (
    <div className='grid gap-4 md:grid-cols-3'>
      {/* Network */}
      <div className='flex items-start gap-3 p-4 rounded-lg border bg-card'>
        <div className='mt-0.5 p-2 rounded-md bg-primary/10'>
          <Network className='h-4 w-4 text-primary' />
        </div>
        <div className='flex-1 min-w-0'>
          <p className='text-sm font-medium text-muted-foreground'>Network</p>
          <p className='text-lg font-semibold mt-1'>{networkDisplayName}</p>
        </div>
      </div>

      {/* Deal Frequency */}
      <div className='flex items-start gap-3 p-4 rounded-lg border bg-card'>
        <div className='mt-0.5 p-2 rounded-md bg-blue-500/10'>
          <Clock className='h-4 w-4 text-blue-500' />
        </div>
        <div className='flex-1 min-w-0'>
          <p className='text-sm font-medium text-muted-foreground'>Deal Creation</p>
          <p className='text-lg font-semibold mt-1'>Every {dealInterval}</p>
        </div>
      </div>

      {/* Retrieval Frequency */}
      <div className='flex items-start gap-3 p-4 rounded-lg border bg-card'>
        <div className='mt-0.5 p-2 rounded-md bg-green-500/10'>
          <Database className='h-4 w-4 text-green-500' />
        </div>
        <div className='flex-1 min-w-0'>
          <p className='text-sm font-medium text-muted-foreground'>Retrieval Tests</p>
          <p className='text-lg font-semibold mt-1'>Every {retrievalInterval}</p>
        </div>
      </div>
    </div>
  );
}
