import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { newMockEvent } from "matchstick-as";
import { afterEach, assert, clearStore, describe, test } from "matchstick-as/assembly/index";
import { RailFinalized } from "../generated/FilecoinPay/FilecoinPay";
import { handleRailFinalized } from "../src/filecoin-pay";
import { handleFwssDataSetCreated } from "../src/fwss";
import { getRailFinalizationEntityId } from "../src/helpers";
import { createFwssDataSetCreatedEvent } from "./fwss-utils";

const SET_ID = BigInt.fromI32(1);
const PDP_RAIL_ID = BigInt.fromI32(99);
const PROVIDER_ADDRESS = Address.fromString("0xa16081f360e3847006db660bae1c6d1b2e17ec2a");
const PAYER_ADDRESS = Address.fromString("0xb16081f360e3847006db660bae1c6d1b2e17ec2b");

function createRailFinalizedEvent(railId: BigInt, blockNumber: BigInt): RailFinalized {
  const ev = changetype<RailFinalized>(newMockEvent());
  ev.parameters = [];
  ev.parameters.push(new ethereum.EventParam("railId", ethereum.Value.fromUnsignedBigInt(railId)));
  ev.block.number = blockNumber;
  return ev;
}

describe("FilecoinPay handlers", () => {
  afterEach(() => {
    clearStore();
  });

  test("RailFinalized creates the entity a DataSet's pdpRailFinalization points at", () => {
    handleFwssDataSetCreated(
      createFwssDataSetCreatedEvent(
        SET_ID,
        BigInt.fromI32(42),
        PDP_RAIL_ID,
        PAYER_ADDRESS,
        PROVIDER_ADDRESS,
        ["withIPFSIndexing"],
        [""],
      ),
    );
    const dataSetId = Bytes.fromByteArray(Bytes.fromBigInt(SET_ID)).toHexString();
    const railFinalizationId = getRailFinalizationEntityId(PDP_RAIL_ID).toHexString();
    assert.notInStore("RailFinalization", railFinalizationId);

    handleRailFinalized(createRailFinalizedEvent(PDP_RAIL_ID, BigInt.fromI32(700)));

    assert.fieldEquals("DataSet", dataSetId, "pdpRailFinalization", railFinalizationId);
    assert.fieldEquals("RailFinalization", railFinalizationId, "blockNumber", "700");
  });
});
