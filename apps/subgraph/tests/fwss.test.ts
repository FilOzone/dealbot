import { assert, beforeEach, clearStore, describe, test } from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  handleBlock,
  handleFwssDataSetCreated,
  handleFwssDataSetServiceProviderChanged,
  handleFwssPdpPaymentTerminated,
  handleFwssPieceAdded,
  handleFwssServiceTerminated,
} from "../src/fwss";
import { getRootEntityId, getBucketId } from "../src/helpers";
import { handleDataSetCreated, handlePiecesAdded } from "../src/pdp-verifier";
import { createDataSetCreatedEvent, createRootsAddedEvent } from "./pdp-verifier-utils";
import {
  createFwssDataSetCreatedEvent,
  createFwssDataSetServiceProviderChangedEvent,
  createFwssPdpPaymentTerminatedEvent,
  createFwssPieceAddedEvent,
  createFwssServiceTerminatedEvent,
  makeBlockAt,
} from "./fwss-utils";

const SET_ID = BigInt.fromI32(1);
const PROVIDER_ID = BigInt.fromI32(42);
const PDP_RAIL_ID = BigInt.fromI32(99);
const ROOT_ID = BigInt.fromI32(101);
const PROVIDER_ADDRESS = Address.fromString("0xa16081f360e3847006db660bae1c6d1b2e17ec2a");
const PAYER_ADDRESS = Address.fromString("0xb16081f360e3847006db660bae1c6d1b2e17ec2b");
const NEW_PROVIDER_ADDRESS = Address.fromString("0xc16081f360e3847006db660bae1c6d1b2e17ec2c");
const CONTRACT_ADDRESS = Address.fromString("0xd16081f360e3847006db660bae1c6d1b2e17ec2d");

const PROOF_SET_ENTITY_ID = Bytes.fromByteArray(Bytes.fromBigInt(SET_ID));

function seedDataSet(): void {
  const ev = createDataSetCreatedEvent(SET_ID, PROVIDER_ADDRESS, Bytes.fromI32(0), CONTRACT_ADDRESS);
  handleDataSetCreated(ev);
}

function seedRoot(): void {
  const ev = createRootsAddedEvent(SET_ID, [ROOT_ID], PROVIDER_ADDRESS, CONTRACT_ADDRESS);
  handlePiecesAdded(ev);
}

describe("FWSS handlers", () => {
  beforeEach(() => {
    clearStore();
  });

  // -- handleFwssDataSetCreated -------------------------------------------

  test("PDPVerifier-created DataSet has withIPFSIndexing = false by default", () => {
    seedDataSet();
    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "withIPFSIndexing", "false");
  });

  test("handleFwssDataSetCreated populates FWSS fields and derives withIPFSIndexing", () => {
    seedDataSet();
    const ev = createFwssDataSetCreatedEvent(
      SET_ID,
      PROVIDER_ID,
      PDP_RAIL_ID,
      PAYER_ADDRESS,
      PROVIDER_ADDRESS,
      ["source", "withIPFSIndexing", "withCDN"],
      ["filecoin-pin", "", "true"],
    );
    handleFwssDataSetCreated(ev);

    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "fwssPayer", PAYER_ADDRESS.toHexString());
    assert.fieldEquals(
      "DataSet",
      PROOF_SET_ENTITY_ID.toHexString(),
      "fwssServiceProvider",
      PROVIDER_ADDRESS.toHexString(),
    );
    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "withIPFSIndexing", "true");
  });

  test("handleFwssDataSetCreated leaves withIPFSIndexing false when key absent", () => {
    seedDataSet();
    const ev = createFwssDataSetCreatedEvent(
      SET_ID,
      PROVIDER_ID,
      PDP_RAIL_ID,
      PAYER_ADDRESS,
      PROVIDER_ADDRESS,
      ["source"],
      ["filecoin-pin"],
    );
    handleFwssDataSetCreated(ev);

    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "withIPFSIndexing", "false");
  });

  test("handleFwssDataSetCreated creates a stub when DataSet doesn't exist yet", () => {
    // FWSS.DataSetCreated fires BEFORE PDPVerifier.DataSetCreated in the same
    // tx (see PDPVerifier._createDataSet). When our handler runs first, it
    // must create a stub with FWSS fields set so the later PDPVerifier handler
    // can load it instead of overwriting.
    const UNSEEN_SET_ID = BigInt.fromI32(999);
    const unseenEntityId = Bytes.fromByteArray(Bytes.fromBigInt(UNSEEN_SET_ID)).toHexString();

    const ev = createFwssDataSetCreatedEvent(
      UNSEEN_SET_ID,
      PROVIDER_ID,
      PDP_RAIL_ID,
      PAYER_ADDRESS,
      PROVIDER_ADDRESS,
      ["withIPFSIndexing"],
      [""],
    );
    handleFwssDataSetCreated(ev);

    assert.fieldEquals("DataSet", unseenEntityId, "setId", "999");
    assert.fieldEquals("DataSet", unseenEntityId, "fwssPayer", PAYER_ADDRESS.toHexString());
    assert.fieldEquals("DataSet", unseenEntityId, "withIPFSIndexing", "true");
    // Placeholder owner set by the FWSS stub (pdp-verifier overwrites later in the same block).
    assert.fieldEquals("DataSet", unseenEntityId, "owner", PROVIDER_ADDRESS.toHexString());
  });

  test("FWSS-then-PDPVerifier ordering preserves both field groups", () => {
    // Simulates real on-chain ordering: FWSS.DataSetCreated fires before
    // PDPVerifier.DataSetCreated. After both handlers run, FWSS and
    // PDPVerifier fields must both be populated correctly.
    const fwssEv = createFwssDataSetCreatedEvent(
      SET_ID,
      PROVIDER_ID,
      PDP_RAIL_ID,
      PAYER_ADDRESS,
      PROVIDER_ADDRESS,
      ["withIPFSIndexing"],
      [""],
    );
    handleFwssDataSetCreated(fwssEv);

    const pdpEv = createDataSetCreatedEvent(SET_ID, PROVIDER_ADDRESS, Bytes.fromI32(0), CONTRACT_ADDRESS);
    handleDataSetCreated(pdpEv);

    // FWSS fields preserved.
    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "withIPFSIndexing", "true");
    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "fwssPayer", PAYER_ADDRESS.toHexString());
    // PDPVerifier fields set.
    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "setId", SET_ID.toString());
    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "isActive", "true");
    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "status", "EMPTY");
  });

  // -- handleFwssPieceAdded -----------------------------------------------

  test("handleFwssPieceAdded extracts ipfsRootCID", () => {
    seedDataSet();
    seedRoot();
    const ev = createFwssPieceAddedEvent(
      SET_ID,
      ROOT_ID,
      Bytes.fromHexString("0xdeadbeef"),
      ["ipfsRootCID"],
      ["bafybeiexamplecid"],
    );
    handleFwssPieceAdded(ev);

    const rootId = getRootEntityId(SET_ID, ROOT_ID).toHexString();
    assert.fieldEquals("Root", rootId, "ipfsRootCID", "bafybeiexamplecid");
  });

  test("handleFwssPieceAdded no-ops for unknown pieceId", () => {
    seedDataSet();
    // no seedRoot — root doesn't exist.
    const ev = createFwssPieceAddedEvent(
      SET_ID,
      BigInt.fromI32(999),
      Bytes.fromHexString("0xdeadbeef"),
      ["ipfsRootCID"],
      ["bafybeinope"],
    );
    handleFwssPieceAdded(ev);

    const rootId = getRootEntityId(SET_ID, BigInt.fromI32(999)).toHexString();
    assert.notInStore("Root", rootId);
  });

  // -- handleFwssServiceTerminated ----------------------------------------

  test("handleFwssServiceTerminated flips isActive to false", () => {
    seedDataSet();
    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "isActive", "true");

    const ev = createFwssServiceTerminatedEvent(SET_ID, PROVIDER_ADDRESS);
    handleFwssServiceTerminated(ev);

    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "isActive", "false");
  });

  test("handleFwssServiceTerminated no-ops for unknown dataSetId", () => {
    const ev = createFwssServiceTerminatedEvent(BigInt.fromI32(999), PROVIDER_ADDRESS);
    handleFwssServiceTerminated(ev);
    assert.notInStore("DataSet", Bytes.fromByteArray(Bytes.fromBigInt(BigInt.fromI32(999))).toHexString());
  });

  // -- handleFwssPdpPaymentTerminated -------------------------------------

  test("handleFwssPdpPaymentTerminated stores endEpoch and leaves isActive alone", () => {
    seedDataSet();
    const ev = createFwssPdpPaymentTerminatedEvent(SET_ID, BigInt.fromI32(12345), PDP_RAIL_ID);
    handleFwssPdpPaymentTerminated(ev);

    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "pdpPaymentEndEpoch", "12345");
    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "isActive", "true");
  });

  test("handleFwssPdpPaymentTerminated with future endEpoch schedules the bucket and keeps isPaymentActive", () => {
    seedDataSet();
    // Default event block.number is 1; endEpoch=12345 is in the future.
    const ev = createFwssPdpPaymentTerminatedEvent(SET_ID, BigInt.fromI32(12345), PDP_RAIL_ID);
    handleFwssPdpPaymentTerminated(ev);

    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "isPaymentActive", "true");
    const bucketId = getBucketId(BigInt.fromI32(12345)).toHexString();
    assert.fieldEquals("PendingPaymentTermination", bucketId, "epoch", "12345");
    assert.fieldEquals(
      "PendingPaymentTermination",
      bucketId,
      "dataSetIds",
      "[" + PROOF_SET_ENTITY_ID.toHexString() + "]",
    );
  });

  test("handleFwssPdpPaymentTerminated with past endEpoch flips isPaymentActive immediately without scheduling", () => {
    seedDataSet();
    // endEpoch=0 is before the event's default block.number=1.
    const ev = createFwssPdpPaymentTerminatedEvent(SET_ID, BigInt.zero(), PDP_RAIL_ID);
    handleFwssPdpPaymentTerminated(ev);

    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "isPaymentActive", "false");
    const bucketId = getBucketId(BigInt.zero()).toHexString();
    assert.notInStore("PendingPaymentTermination", bucketId);
  });

  test("handleFwssPdpPaymentTerminated with endEpoch equal to current block flips immediately", () => {
    seedDataSet();
    // endEpoch == block.number (default 1): treated as already past.
    const ev = createFwssPdpPaymentTerminatedEvent(SET_ID, BigInt.fromI32(1), PDP_RAIL_ID);
    handleFwssPdpPaymentTerminated(ev);

    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "isPaymentActive", "false");
    const bucketId = getBucketId(BigInt.fromI32(1)).toHexString();
    assert.notInStore("PendingPaymentTermination", bucketId);
  });

  test("re-termination unschedules the previous bucket and reschedules under the new epoch", () => {
    seedDataSet();
    handleFwssPdpPaymentTerminated(createFwssPdpPaymentTerminatedEvent(SET_ID, BigInt.fromI32(100), PDP_RAIL_ID));
    handleFwssPdpPaymentTerminated(createFwssPdpPaymentTerminatedEvent(SET_ID, BigInt.fromI32(200), PDP_RAIL_ID));

    const oldBucket = getBucketId(BigInt.fromI32(100)).toHexString();
    const newBucket = getBucketId(BigInt.fromI32(200)).toHexString();
    assert.notInStore("PendingPaymentTermination", oldBucket);
    assert.fieldEquals(
      "PendingPaymentTermination",
      newBucket,
      "dataSetIds",
      "[" + PROOF_SET_ENTITY_ID.toHexString() + "]",
    );
    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "pdpPaymentEndEpoch", "200");
  });

  test("re-termination with a future endEpoch restores isPaymentActive after a prior termination elapsed", () => {
    // Simulates: termination scheduled, epoch passes (flag flips false), then a
    // new PDPPaymentTerminated pushes the end into the future. The dataset is
    // paying again until the new epoch, so the flag must flip back to true.
    seedDataSet();
    handleFwssPdpPaymentTerminated(createFwssPdpPaymentTerminatedEvent(SET_ID, BigInt.fromI32(100), PDP_RAIL_ID));
    handleBlock(makeBlockAt(BigInt.fromI32(100)));
    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "isPaymentActive", "false");

    handleFwssPdpPaymentTerminated(createFwssPdpPaymentTerminatedEvent(SET_ID, BigInt.fromI32(500), PDP_RAIL_ID));

    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "isPaymentActive", "true");
    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "pdpPaymentEndEpoch", "500");
    const newBucket = getBucketId(BigInt.fromI32(500)).toHexString();
    assert.fieldEquals(
      "PendingPaymentTermination",
      newBucket,
      "dataSetIds",
      "[" + PROOF_SET_ENTITY_ID.toHexString() + "]",
    );
  });

  // -- handleBlock --------------------------------------------------------

  test("handleBlock flips isPaymentActive and removes the bucket at the scheduled epoch", () => {
    seedDataSet();
    handleFwssPdpPaymentTerminated(createFwssPdpPaymentTerminatedEvent(SET_ID, BigInt.fromI32(500), PDP_RAIL_ID));
    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "isPaymentActive", "true");

    handleBlock(makeBlockAt(BigInt.fromI32(500)));

    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "isPaymentActive", "false");
    const bucketId = getBucketId(BigInt.fromI32(500)).toHexString();
    assert.notInStore("PendingPaymentTermination", bucketId);
  });

  test("handleBlock is a no-op when no bucket exists for the current block", () => {
    seedDataSet();
    // No PDPPaymentTerminated fired; isPaymentActive must stay true after a tick.
    handleBlock(makeBlockAt(BigInt.fromI32(7)));
    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "isPaymentActive", "true");
  });

  test("handleBlock skips datasets whose pdpPaymentEndEpoch no longer matches the bucket epoch", () => {
    // Defense in depth: if a stale bucket entry survives (re-termination races
    // or future schema changes), the block handler re-checks the dataset's
    // current end epoch before flipping.
    seedDataSet();
    handleFwssPdpPaymentTerminated(createFwssPdpPaymentTerminatedEvent(SET_ID, BigInt.fromI32(100), PDP_RAIL_ID));
    handleFwssPdpPaymentTerminated(createFwssPdpPaymentTerminatedEvent(SET_ID, BigInt.fromI32(200), PDP_RAIL_ID));

    // Firing the OLD epoch should not flip — the dataset is now scheduled for 200.
    handleBlock(makeBlockAt(BigInt.fromI32(100)));
    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "isPaymentActive", "true");

    // Firing the NEW epoch flips.
    handleBlock(makeBlockAt(BigInt.fromI32(200)));
    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "isPaymentActive", "false");
  });

  test("handleFwssServiceTerminated also flips isPaymentActive and removes the bucket entry", () => {
    seedDataSet();
    handleFwssPdpPaymentTerminated(createFwssPdpPaymentTerminatedEvent(SET_ID, BigInt.fromI32(300), PDP_RAIL_ID));

    handleFwssServiceTerminated(createFwssServiceTerminatedEvent(SET_ID, PROVIDER_ADDRESS));

    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "isActive", "false");
    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "isPaymentActive", "false");
    const bucketId = getBucketId(BigInt.fromI32(300)).toHexString();
    assert.notInStore("PendingPaymentTermination", bucketId);
  });

  test("DataSet is created with isPaymentActive=true by default", () => {
    seedDataSet();
    assert.fieldEquals("DataSet", PROOF_SET_ENTITY_ID.toHexString(), "isPaymentActive", "true");
  });

  test("handleFwssPdpPaymentTerminated no-ops for unknown dataSetId", () => {
    const ev = createFwssPdpPaymentTerminatedEvent(BigInt.fromI32(999), BigInt.fromI32(12345), PDP_RAIL_ID);
    handleFwssPdpPaymentTerminated(ev);
    assert.notInStore("DataSet", Bytes.fromByteArray(Bytes.fromBigInt(BigInt.fromI32(999))).toHexString());
  });

  // -- handleFwssDataSetServiceProviderChanged ----------------------------

  test("handleFwssDataSetServiceProviderChanged updates fwssServiceProvider", () => {
    seedDataSet();
    handleFwssDataSetCreated(
      createFwssDataSetCreatedEvent(SET_ID, PROVIDER_ID, PDP_RAIL_ID, PAYER_ADDRESS, PROVIDER_ADDRESS, [], []),
    );

    const ev = createFwssDataSetServiceProviderChangedEvent(SET_ID, PROVIDER_ADDRESS, NEW_PROVIDER_ADDRESS);
    handleFwssDataSetServiceProviderChanged(ev);

    assert.fieldEquals(
      "DataSet",
      PROOF_SET_ENTITY_ID.toHexString(),
      "fwssServiceProvider",
      NEW_PROVIDER_ADDRESS.toHexString(),
    );
  });

  test("handleFwssDataSetServiceProviderChanged no-ops for unknown dataSetId", () => {
    const ev = createFwssDataSetServiceProviderChangedEvent(
      BigInt.fromI32(999),
      PROVIDER_ADDRESS,
      NEW_PROVIDER_ADDRESS,
    );
    handleFwssDataSetServiceProviderChanged(ev);
    assert.notInStore("DataSet", Bytes.fromByteArray(Bytes.fromBigInt(BigInt.fromI32(999))).toHexString());
  });

  // -- End-to-end: backs GET_FWSS_CANDIDATE_PIECES query ------------------

  test("GET_FWSS_CANDIDATE_PIECES: DataSet + Root populated with filterable fields", () => {
    // FWSS stub first (matches on-chain ordering).
    const fwssDsEv = createFwssDataSetCreatedEvent(
      SET_ID,
      PROVIDER_ID,
      PDP_RAIL_ID,
      PAYER_ADDRESS,
      PROVIDER_ADDRESS,
      ["withIPFSIndexing"],
      [""],
    );
    handleFwssDataSetCreated(fwssDsEv);

    // PDPVerifier DataSetCreated fills in PDPVerifier-layer fields.
    handleDataSetCreated(createDataSetCreatedEvent(SET_ID, PROVIDER_ADDRESS, Bytes.fromI32(0), CONTRACT_ADDRESS));

    // PiecesAdded creates Root.
    handlePiecesAdded(createRootsAddedEvent(SET_ID, [ROOT_ID], PROVIDER_ADDRESS, CONTRACT_ADDRESS));

    // FWSS.PieceAdded adds ipfsRootCID.
    handleFwssPieceAdded(
      createFwssPieceAddedEvent(SET_ID, ROOT_ID, Bytes.fromHexString("0xdeadbeef"), ["ipfsRootCID"], [
        "bafybeiexamplecid",
      ]),
    );

    const dsId = PROOF_SET_ENTITY_ID.toHexString();
    assert.fieldEquals("DataSet", dsId, "isActive", "true");
    assert.fieldEquals("DataSet", dsId, "withIPFSIndexing", "true");
    assert.fieldEquals("DataSet", dsId, "fwssPayer", PAYER_ADDRESS.toHexString());
    assert.fieldEquals("DataSet", dsId, "fwssServiceProvider", PROVIDER_ADDRESS.toHexString());

    const rootId = getRootEntityId(SET_ID, ROOT_ID).toHexString();
    assert.fieldEquals("Root", rootId, "removed", "false");
    assert.fieldEquals("Root", rootId, "ipfsRootCID", "bafybeiexamplecid");
  });
});
