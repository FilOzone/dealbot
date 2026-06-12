import { BigInt, Bytes, ethereum, log, store } from "@graphprotocol/graph-ts";
import {
  DataSetCreated as DataSetCreatedEvent,
  DataSetServiceProviderChanged as DataSetServiceProviderChangedEvent,
  PDPPaymentTerminated as PDPPaymentTerminatedEvent,
  PieceAdded as PieceAddedEvent,
  ServiceTerminated as ServiceTerminatedEvent,
} from "../generated/FilecoinWarmStorageService/FilecoinWarmStorageService";
import { DataSet, PendingPaymentTermination, Root } from "../generated/schema";
import {
  arrayContains,
  extractMetadataValue,
  getProofSetEntityId,
  getRootEntityId,
  getBucketId,
} from "./helpers";
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
    ds.isPaymentActive = true;
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
  ds.isPaymentActive = false;
  const scheduledEpoch = ds.pdpPaymentEndEpoch;
  if (scheduledEpoch !== null) {
    unschedulePaymentTermination(ds.id, scheduledEpoch);
  }

  ds.save();
}

export function handleFwssPdpPaymentTerminated(event: PDPPaymentTerminatedEvent): void {
  const ds = DataSet.load(getProofSetEntityId(event.params.dataSetId));
  if (ds == null) {
    log.warning("FWSS PDPPaymentTerminated for unknown dataSet {}", [event.params.dataSetId.toString()]);
    return;
  }

  const previousEpoch = ds.pdpPaymentEndEpoch;
  if (previousEpoch !== null && previousEpoch.notEqual(event.params.endEpoch)) {
    unschedulePaymentTermination(ds.id, previousEpoch);
  }

  ds.pdpPaymentEndEpoch = event.params.endEpoch;

  if (event.params.endEpoch.le(event.block.number)) {
    // Termination epoch already reached (or in the past). Flip immediately —
    // no point scheduling a bucket for a block the chain has already passed.
    ds.isPaymentActive = false;
  } else {
    // Payment is flowing until `endEpoch`. This covers the re-extension case
    // where a prior termination's epoch already elapsed (isPaymentActive was
    // flipped false by the block handler) and a new PDPPaymentTerminated
    // pushes the end into the future — the dataset is paying again until
    // that new epoch. The block handler at endEpoch will flip back to false.
    ds.isPaymentActive = true;
    schedulePaymentTermination(ds.id, event.params.endEpoch);
  }

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

/**
 * Block handler: flip `isPaymentActive` to false on every DataSet whose
 * `pdpPaymentEndEpoch` equals the current block. In the steady state this
 * is a single bucket load returning null, so the per-block cost is O(1).
 */
export function handleBlock(block: ethereum.Block): void {
  const bucketId = getBucketId(block.number);
  const bucket = PendingPaymentTermination.load(bucketId);
  if (bucket == null) {
    return;
  }

  const ids = bucket.dataSetIds;
  for (let i = 0; i < ids.length; i++) {
    const ds = DataSet.load(ids[i]);
    if (ds == null) {
      continue;
    }

    if (ds.pdpPaymentEndEpoch === null) {
      continue;
    }

    if ((ds.pdpPaymentEndEpoch as BigInt).notEqual(block.number)) {
      continue;
    }

    ds.isPaymentActive = false;
    ds.save();
  }

  store.remove("PendingPaymentTermination", bucketId.toHexString());
}

// ---- Pending-termination bucket helpers -----------------------------------

/**
 * Append `dataSetId` to the bucket for `epoch` so that `handleBlock` can flip
 * its `isPaymentActive` when the chain reaches that block. Creates the bucket
 * entity on first insert. Idempotent: if `dataSetId` is already in the bucket,
 * returns without re-saving (avoids redundant store writes from duplicate
 * event replays).
 */
function schedulePaymentTermination(dataSetId: Bytes, epoch: BigInt): void {
  const bucketId = getBucketId(epoch);

  let bucket = PendingPaymentTermination.load(bucketId);
  if (bucket == null) {
    bucket = new PendingPaymentTermination(bucketId);
    bucket.epoch = epoch;
    bucket.dataSetIds = [];
  }

  const ids = bucket.dataSetIds;
  for (let i = 0; i < ids.length; i++) {
    if (ids[i].equals(dataSetId)) {
      // Already scheduled — re-saving the bucket would be a no-op.
      return;
    }
  }
  ids.push(dataSetId);
  bucket.dataSetIds = ids;
  bucket.save();
}

/**
 * Remove `dataSetId` from the bucket for `epoch`, deleting the bucket entity
 * entirely once it goes empty so the steady-state bucket store doesn't grow
 * unboundedly. Called when a dataset is re-terminated at a different epoch or
 * when `FWSS.ServiceTerminated` makes the prior schedule moot. No-ops if the
 * bucket no longer exists (block handler already consumed it) — the matching
 * `handleBlock` re-check is the safety net for that race.
 */
function unschedulePaymentTermination(dataSetId: Bytes, epoch: BigInt): void {
  const bucketId = getBucketId(epoch);
  const bucket = PendingPaymentTermination.load(bucketId);
  if (bucket == null) {
    return;
  }

  const filtered: Bytes[] = [];
  for (let i = 0; i < bucket.dataSetIds.length; i++) {
    if (!bucket.dataSetIds[i].equals(dataSetId)) {
      filtered.push(bucket.dataSetIds[i]);
    }
  }

  if (filtered.length == 0) {
    store.remove("PendingPaymentTermination", bucketId.toHexString());
    return;
  }

  bucket.dataSetIds = filtered;
  bucket.save();
}
