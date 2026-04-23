import { BigInt, log } from "@graphprotocol/graph-ts";
import {
  DataSetCreated as DataSetCreatedEvent,
  DataSetDeleted as DataSetDeletedEvent,
  DataSetEmpty as DataSetEmptyEvent,
  NextProvingPeriod as NextProvingPeriodEvent,
  PiecesAdded as PiecesAddedEvent,
  PiecesRemoved as PiecesRemovedEvent,
  PossessionProven as PossessionProvenEvent,
  StorageProviderChanged as StorageProviderChangedEvent,
} from "../generated/PDPVerifier/PDPVerifier";
import { DataSet, Provider, Root } from "../generated/schema";
import {
  getProofSetEntityId,
  getRootEntityId,
  getRootSampleKey,
  maxProvingPeriodFor,
  unpaddedSize,
  validateCommPv2,
} from "./helpers";
import { DataSetStatus } from "./types";

// ---- Handlers -------------------------------------------------------------

export function handleDataSetCreated(event: DataSetCreatedEvent): void {
  const proofSetEntityId = getProofSetEntityId(event.params.setId);
  const providerEntityId = event.params.storageProvider;

  // FWSS.dataSetCreated fires BEFORE PDPVerifier's own DataSetCreated event
  // (see PDPVerifier._createDataSet: listener callback runs, THEN `emit
  // DataSetCreated`). If the listener is FWSS, handleFwssDataSetCreated has
  // already created a stub entity with FWSS-layer fields populated. Load to
  // preserve those fields.
  let proofSet = DataSet.load(proofSetEntityId);
  if (proofSet == null) {
    proofSet = new DataSet(proofSetEntityId);
    proofSet.withIPFSIndexing = false;
    proofSet.createdAt = event.block.timestamp;
    // fwssPayer, fwssServiceProvider, pdpPaymentEndEpoch are nullable.
  }
  proofSet.setId = event.params.setId;
  proofSet.owner = providerEntityId;
  proofSet.isActive = true;
  proofSet.status = DataSetStatus.EMPTY;
  proofSet.nextDeadline = BigInt.zero();
  proofSet.maxProvingPeriod = BigInt.zero();
  proofSet.provenThisPeriod = false;
  proofSet.save();

  let provider = Provider.load(providerEntityId);
  if (provider == null) {
    provider = new Provider(providerEntityId);
    provider.address = event.params.storageProvider;
    provider.totalFaultedPeriods = BigInt.zero();
    provider.totalProvingPeriods = BigInt.zero();
    provider.save();
  }
}

export function handleDataSetDeleted(event: DataSetDeletedEvent): void {
  const proofSet = DataSet.load(getProofSetEntityId(event.params.setId));
  if (proofSet == null) {
    log.warning("DataSetDeleted: DataSet {} not found", [event.params.setId.toString()]);
    return;
  }

  proofSet.isActive = false;
  proofSet.status = DataSetStatus.DELETED;
  proofSet.nextDeadline = BigInt.zero();
  proofSet.save();
}

export function handleStorageProviderChanged(event: StorageProviderChangedEvent): void {
  const proofSet = DataSet.load(getProofSetEntityId(event.params.setId));
  if (proofSet == null) {
    log.warning("StorageProviderChanged: DataSet {} not found", [event.params.setId.toString()]);
    return;
  }

  const newProviderId = event.params.newStorageProvider;
  let newProvider = Provider.load(newProviderId);
  if (newProvider == null) {
    newProvider = new Provider(newProviderId);
    newProvider.address = newProviderId;
    newProvider.totalFaultedPeriods = BigInt.zero();
    newProvider.totalProvingPeriods = BigInt.zero();
    newProvider.save();
  }

  proofSet.owner = newProviderId;
  proofSet.save();
}

export function handleDataSetEmpty(event: DataSetEmptyEvent): void {
  const proofSet = DataSet.load(getProofSetEntityId(event.params.setId));
  if (proofSet == null) {
    log.warning("DataSetEmpty: DataSet {} not found", [event.params.setId.toString()]);
    return;
  }

  proofSet.status = DataSetStatus.EMPTY;
  // Zero nextDeadline so the next PiecesAdded + NextProvingPeriod round
  // re-enters the first-init branch and promotes to PROVING again.
  proofSet.nextDeadline = BigInt.zero();
  proofSet.maxProvingPeriod = BigInt.zero();
  proofSet.provenThisPeriod = false;
  proofSet.save();
}

export function handlePossessionProven(event: PossessionProvenEvent): void {
  const proofSet = DataSet.load(getProofSetEntityId(event.params.setId));
  if (proofSet == null) {
    log.warning("PossessionProven: DataSet {} not found", [event.params.setId.toString()]);
    return;
  }

  // Flip the flag so the next NextProvingPeriod classifies this period as
  // proven rather than faulted.
  proofSet.provenThisPeriod = true;
  proofSet.save();
}

export function handleNextProvingPeriod(event: NextProvingPeriodEvent): void {
  const setId = event.params.setId;
  const currentBlockNumber = event.block.number;

  const proofSet = DataSet.load(getProofSetEntityId(setId));
  if (proofSet == null) {
    log.warning("NextProvingPeriod: DataSet {} not found", [setId.toString()]);
    return;
  }

  let periodsSkipped: BigInt = BigInt.zero();
  let faultedPeriods: BigInt = BigInt.zero();
  let nextDeadline: BigInt;

  if (proofSet.nextDeadline.equals(BigInt.zero())) {
    // First-init: promote to PROVING, seed maxProvingPeriod.
    proofSet.status = DataSetStatus.PROVING;
    proofSet.maxProvingPeriod = BigInt.fromI32(maxProvingPeriodFor(event.address));
    nextDeadline = currentBlockNumber.plus(proofSet.maxProvingPeriod);
  } else {
    if (currentBlockNumber.gt(proofSet.nextDeadline)) {
      periodsSkipped = currentBlockNumber
        .minus(proofSet.nextDeadline.plus(BigInt.fromI32(1)))
        .div(proofSet.maxProvingPeriod);
    }
    nextDeadline = proofSet.nextDeadline.plus(
      proofSet.maxProvingPeriod.times(periodsSkipped.plus(BigInt.fromI32(1))),
    );
    faultedPeriods = proofSet.provenThisPeriod ? periodsSkipped : periodsSkipped.plus(BigInt.fromI32(1));
  }

  proofSet.nextDeadline = nextDeadline;
  proofSet.provenThisPeriod = false;
  proofSet.save();

  const provider = Provider.load(proofSet.owner);
  if (provider != null) {
    provider.totalFaultedPeriods = provider.totalFaultedPeriods.plus(faultedPeriods);
    provider.totalProvingPeriods = provider.totalProvingPeriods.plus(periodsSkipped.plus(BigInt.fromI32(1)));
    provider.save();
  }
}

export function handlePiecesAdded(event: PiecesAddedEvent): void {
  const setId = event.params.setId;
  const rootIdsFromEvent = event.params.pieceIds;
  const pieceCidsFromEvent = event.params.pieceCids;

  const proofSet = DataSet.load(getProofSetEntityId(setId));
  if (proofSet == null) {
    log.warning("handlePiecesAdded: DataSet {} not found", [setId.toString()]);
    return;
  }

  let addedAny = false;

  for (let i = 0; i < rootIdsFromEvent.length; i++) {
    const rootId = rootIdsFromEvent[i];
    const pieceCid = pieceCidsFromEvent[i];

    const pieceBytes = pieceCid.data;
    const commPData = validateCommPv2(pieceBytes);
    const rawSize = commPData.isValid ? unpaddedSize(commPData.padding, commPData.height) : BigInt.zero();

    const rootEntityId = getRootEntityId(setId, rootId);
    if (Root.load(rootEntityId) != null) {
      log.warning("handlePiecesAdded: Root {} for Set {} already exists; skipping", [
        rootId.toString(),
        setId.toString(),
      ]);
      continue;
    }

    const root = new Root(rootEntityId);
    root.setId = setId;
    root.rootId = rootId;
    root.rawSize = rawSize;
    root.cid = pieceBytes;
    root.removed = false;
    root.createdAt = event.block.timestamp;
    root.proofSet = getProofSetEntityId(setId);
    root.sampleKey = getRootSampleKey(rootEntityId);
    // ipfsRootCID: patched in FWSS handler if applicable.
    root.save();

    addedAny = true;
  }

  // First non-empty add transitions the DataSet to READY. NextProvingPeriod
  // will then promote it to PROVING.
  if (addedAny && proofSet.status == DataSetStatus.EMPTY) {
    proofSet.status = DataSetStatus.READY;
    proofSet.save();
  }
}

export function handlePiecesRemoved(event: PiecesRemovedEvent): void {
  const setId = event.params.setId;
  const rootIds = event.params.pieceIds;

  for (let i = 0; i < rootIds.length; i++) {
    const root = Root.load(getRootEntityId(setId, rootIds[i]));
    if (root == null) {
      log.warning("handlePiecesRemoved: Root {} for Set {} not found", [rootIds[i].toString(), setId.toString()]);
      continue;
    }
    root.removed = true;
    root.save();
  }
}
