import { BigInt, log } from "@graphprotocol/graph-ts";
import {
  DataSetCreated as DataSetCreatedEvent,
  DataSetServiceProviderChanged as DataSetServiceProviderChangedEvent,
  PDPPaymentTerminated as PDPPaymentTerminatedEvent,
  PieceAdded as PieceAddedEvent,
  ServiceTerminated as ServiceTerminatedEvent,
} from "../generated/FilecoinWarmStorageService/FilecoinWarmStorageService";
import { DataSet, Root } from "../generated/schema";
import { arrayContains, extractMetadataValue, getProofSetEntityId, getRootEntityId } from "./helpers";
import { DataSetStatus } from "./types";

// ---- Handlers -------------------------------------------------------------

export function handleFwssDataSetCreated(event: DataSetCreatedEvent): void {
  const id = getProofSetEntityId(event.params.dataSetId);
  // FWSS.DataSetCreated fires BEFORE PDPVerifier's own DataSetCreated event
  // (see PDPVerifier._createDataSet: listener callback runs first, THEN
  // `emit DataSetCreated`). If no entity exists yet, create a stub with
  // required defaults; pdp-verifier.handleDataSetCreated will run later in
  // the same block and fill in PDPVerifier-level fields. Since handlers run
  // sequentially and atomically within a block, no GraphQL query can observe
  // that intermediate state.
  let ds = DataSet.load(id);
  if (ds == null) {
    ds = new DataSet(id);
    ds.setId = event.params.dataSetId;
    // PDPVerifier-level non-null defaults; handleDataSetCreated will overwrite.
    ds.owner = event.params.serviceProvider;
    ds.isActive = true;
    ds.status = DataSetStatus.EMPTY;
    ds.nextDeadline = BigInt.zero();
    ds.maxProvingPeriod = BigInt.zero();
    ds.provenThisPeriod = false;
    ds.createdAt = event.block.timestamp;
  }

  ds.fwssPayer = event.params.payer;
  ds.fwssServiceProvider = event.params.serviceProvider;
  ds.withIPFSIndexing = arrayContains(event.params.metadataKeys, "withIPFSIndexing");
  ds.save();
}

export function handleFwssPieceAdded(event: PieceAddedEvent): void {
  const root = Root.load(getRootEntityId(event.params.dataSetId, event.params.pieceId));
  if (root == null) {
    log.warning("FWSS PieceAdded for unknown root {}-{}", [
      event.params.dataSetId.toString(),
      event.params.pieceId.toString(),
    ]);
    return;
  }

  root.ipfsRootCID = extractMetadataValue(event.params.keys, event.params.values, "ipfsRootCID");
  root.save();
}

export function handleFwssServiceTerminated(event: ServiceTerminatedEvent): void {
  const ds = DataSet.load(getProofSetEntityId(event.params.dataSetId));
  if (ds == null) {
    log.warning("FWSS ServiceTerminated for unknown dataSet {}", [event.params.dataSetId.toString()]);
    return;
  }

  ds.isActive = false;
  ds.save();
}

export function handleFwssPdpPaymentTerminated(event: PDPPaymentTerminatedEvent): void {
  const ds = DataSet.load(getProofSetEntityId(event.params.dataSetId));
  if (ds == null) {
    log.warning("FWSS PDPPaymentTerminated for unknown dataSet {}", [event.params.dataSetId.toString()]);
    return;
  }

  ds.pdpPaymentEndEpoch = event.params.endEpoch;
  ds.save();
}

export function handleFwssDataSetServiceProviderChanged(event: DataSetServiceProviderChangedEvent): void {
  const ds = DataSet.load(getProofSetEntityId(event.params.dataSetId));
  if (ds == null) {
    log.warning("FWSS DataSetServiceProviderChanged for unknown dataSet {}", [
      event.params.dataSetId.toString(),
    ]);
    return;
  }

  ds.fwssServiceProvider = event.params.newServiceProvider;
  ds.save();
}
