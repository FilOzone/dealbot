import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { newMockEvent } from "matchstick-as";
import {
  DataSetCreated as FwssDataSetCreated,
  DataSetServiceProviderChanged as FwssDataSetServiceProviderChanged,
  PDPPaymentTerminated as FwssPdpPaymentTerminated,
  PieceAdded as FwssPieceAdded,
  ServiceTerminated as FwssServiceTerminated,
} from "../generated/FilecoinWarmStorageService/FilecoinWarmStorageService";

// FWSS DataSetCreated:
//   dataSetId, providerId, pdpRailId, cacheMissRailId, cdnRailId,
//   payer, serviceProvider, payee, metadataKeys[], metadataValues[]
export function createFwssDataSetCreatedEvent(
  dataSetId: BigInt,
  providerId: BigInt,
  pdpRailId: BigInt,
  payer: Address,
  serviceProvider: Address,
  metadataKeys: string[],
  metadataValues: string[],
  blockNumber: BigInt = BigInt.fromI32(1),
  timestamp: BigInt = BigInt.fromI32(1),
): FwssDataSetCreated {
  const ev = changetype<FwssDataSetCreated>(newMockEvent());
  ev.parameters = [];

  ev.parameters.push(new ethereum.EventParam("dataSetId", ethereum.Value.fromUnsignedBigInt(dataSetId)));
  ev.parameters.push(new ethereum.EventParam("providerId", ethereum.Value.fromUnsignedBigInt(providerId)));
  ev.parameters.push(new ethereum.EventParam("pdpRailId", ethereum.Value.fromUnsignedBigInt(pdpRailId)));
  ev.parameters.push(new ethereum.EventParam("cacheMissRailId", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0))));
  ev.parameters.push(new ethereum.EventParam("cdnRailId", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0))));
  ev.parameters.push(new ethereum.EventParam("payer", ethereum.Value.fromAddress(payer)));
  ev.parameters.push(new ethereum.EventParam("serviceProvider", ethereum.Value.fromAddress(serviceProvider)));
  ev.parameters.push(new ethereum.EventParam("payee", ethereum.Value.fromAddress(serviceProvider)));
  ev.parameters.push(new ethereum.EventParam("metadataKeys", ethereum.Value.fromStringArray(metadataKeys)));
  ev.parameters.push(new ethereum.EventParam("metadataValues", ethereum.Value.fromStringArray(metadataValues)));

  ev.block.number = blockNumber;
  ev.block.timestamp = timestamp;
  return ev;
}

// FWSS PieceAdded: dataSetId, pieceId, Cids.Cid (tuple(bytes)), keys[], values[]
export function createFwssPieceAddedEvent(
  dataSetId: BigInt,
  pieceId: BigInt,
  pieceCidBytes: Bytes,
  keys: string[],
  values: string[],
  blockNumber: BigInt = BigInt.fromI32(1),
  timestamp: BigInt = BigInt.fromI32(1),
): FwssPieceAdded {
  const ev = changetype<FwssPieceAdded>(newMockEvent());
  ev.parameters = [];

  ev.parameters.push(new ethereum.EventParam("dataSetId", ethereum.Value.fromUnsignedBigInt(dataSetId)));
  ev.parameters.push(new ethereum.EventParam("pieceId", ethereum.Value.fromUnsignedBigInt(pieceId)));

  const cidTuple = new ethereum.Tuple();
  cidTuple.push(ethereum.Value.fromBytes(pieceCidBytes));
  ev.parameters.push(new ethereum.EventParam("pieceCid", ethereum.Value.fromTuple(cidTuple)));

  ev.parameters.push(new ethereum.EventParam("keys", ethereum.Value.fromStringArray(keys)));
  ev.parameters.push(new ethereum.EventParam("values", ethereum.Value.fromStringArray(values)));

  ev.block.number = blockNumber;
  ev.block.timestamp = timestamp;
  return ev;
}

// FWSS ServiceTerminated: caller, dataSetId, pdpRailId, cacheMissRailId, cdnRailId
export function createFwssServiceTerminatedEvent(
  dataSetId: BigInt,
  caller: Address,
  blockNumber: BigInt = BigInt.fromI32(1),
  timestamp: BigInt = BigInt.fromI32(1),
): FwssServiceTerminated {
  const ev = changetype<FwssServiceTerminated>(newMockEvent());
  ev.parameters = [];

  ev.parameters.push(new ethereum.EventParam("caller", ethereum.Value.fromAddress(caller)));
  ev.parameters.push(new ethereum.EventParam("dataSetId", ethereum.Value.fromUnsignedBigInt(dataSetId)));
  ev.parameters.push(new ethereum.EventParam("pdpRailId", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0))));
  ev.parameters.push(new ethereum.EventParam("cacheMissRailId", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0))));
  ev.parameters.push(new ethereum.EventParam("cdnRailId", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0))));

  ev.block.number = blockNumber;
  ev.block.timestamp = timestamp;
  return ev;
}

// FWSS PDPPaymentTerminated: dataSetId, endEpoch, pdpRailId
export function createFwssPdpPaymentTerminatedEvent(
  dataSetId: BigInt,
  endEpoch: BigInt,
  pdpRailId: BigInt,
  blockNumber: BigInt = BigInt.fromI32(1),
  timestamp: BigInt = BigInt.fromI32(1),
): FwssPdpPaymentTerminated {
  const ev = changetype<FwssPdpPaymentTerminated>(newMockEvent());
  ev.parameters = [];

  ev.parameters.push(new ethereum.EventParam("dataSetId", ethereum.Value.fromUnsignedBigInt(dataSetId)));
  ev.parameters.push(new ethereum.EventParam("endEpoch", ethereum.Value.fromUnsignedBigInt(endEpoch)));
  ev.parameters.push(new ethereum.EventParam("pdpRailId", ethereum.Value.fromUnsignedBigInt(pdpRailId)));

  ev.block.number = blockNumber;
  ev.block.timestamp = timestamp;
  return ev;
}

// FWSS DataSetServiceProviderChanged: dataSetId, oldServiceProvider, newServiceProvider
export function createFwssDataSetServiceProviderChangedEvent(
  dataSetId: BigInt,
  oldServiceProvider: Address,
  newServiceProvider: Address,
  blockNumber: BigInt = BigInt.fromI32(1),
  timestamp: BigInt = BigInt.fromI32(1),
): FwssDataSetServiceProviderChanged {
  const ev = changetype<FwssDataSetServiceProviderChanged>(newMockEvent());
  ev.parameters = [];

  ev.parameters.push(new ethereum.EventParam("dataSetId", ethereum.Value.fromUnsignedBigInt(dataSetId)));
  ev.parameters.push(new ethereum.EventParam("oldServiceProvider", ethereum.Value.fromAddress(oldServiceProvider)));
  ev.parameters.push(new ethereum.EventParam("newServiceProvider", ethereum.Value.fromAddress(newServiceProvider)));

  ev.block.number = blockNumber;
  ev.block.timestamp = timestamp;
  return ev;
}
