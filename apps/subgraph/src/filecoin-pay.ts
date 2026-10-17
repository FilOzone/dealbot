import { RailFinalized as RailFinalizedEvent } from "../generated/FilecoinPay/FilecoinPay";
import { RailFinalization } from "../generated/schema";
import { getRailFinalizationEntityId } from "./helpers";

// RailFinalized fires at most once per railId (the rail is zeroed), so an immutable create is safe.
export function handleRailFinalized(event: RailFinalizedEvent): void {
  const railFinalization = new RailFinalization(getRailFinalizationEntityId(event.params.railId));
  railFinalization.blockNumber = event.block.number;
  railFinalization.save();
}
