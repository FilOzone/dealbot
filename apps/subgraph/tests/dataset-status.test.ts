import { afterEach, assert, clearStore, describe, test } from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  handleDataSetCreated,
  handleDataSetDeleted,
  handleDataSetEmpty,
  handleNextProvingPeriod,
  handlePiecesAdded,
} from "../src/pdp-verifier";
import {
  createDataSetCreatedEvent,
  createDataSetDeletedEvent,
  createDataSetEmptyEvent,
  createNextProvingPeriodEvent,
  createRootsAddedEvent,
  generateTxHash,
} from "./pdp-verifier-utils";

const SET_ID = BigInt.fromI32(1);
const ROOT_ID_1 = BigInt.fromI32(101);
const SENDER_ADDRESS = Address.fromString("0xa16081f360e3847006db660bae1c6d1b2e17ec2a");
const CONTRACT_ADDRESS = Address.fromString("0xb16081f360e3847006db660bae1c6d1b2e17ec2b");
const PROOF_SET_ID_BYTES = Bytes.fromBigInt(SET_ID);

function createAndSubmitDataSet(txId: i32): void {
  const event = createDataSetCreatedEvent(
    SET_ID,
    SENDER_ADDRESS,
    Bytes.fromI32(123),
    CONTRACT_ADDRESS,
    BigInt.fromI32(100),
    BigInt.fromI32(1678886400),
    generateTxHash(txId),
    BigInt.fromI32(0),
  );
  handleDataSetCreated(event);
}

function addRoots(txId: i32, blockNumber: i32): void {
  const rootsEvent = createRootsAddedEvent(SET_ID, [ROOT_ID_1], SENDER_ADDRESS, CONTRACT_ADDRESS);
  rootsEvent.block.timestamp = BigInt.fromI32(1678886500);
  rootsEvent.block.number = BigInt.fromI32(blockNumber);
  rootsEvent.logIndex = BigInt.fromI32(1);
  rootsEvent.transaction.hash = generateTxHash(txId);
  handlePiecesAdded(rootsEvent);
}

function nextProvingPeriod(txId: i32, blockNumber: i32, challengeEpoch: i32): void {
  const event = createNextProvingPeriodEvent(
    SET_ID,
    BigInt.fromI32(challengeEpoch),
    BigInt.fromI32(32),
    CONTRACT_ADDRESS,
    BigInt.fromI32(blockNumber),
    BigInt.fromI32(1678886600),
    generateTxHash(txId),
    BigInt.fromI32(0),
  );
  handleNextProvingPeriod(event);
}

describe("DataSetStatus Lifecycle Tests", () => {
  afterEach(() => {
    clearStore();
  });

  test("handleDataSetCreated sets status to EMPTY", () => {
    createAndSubmitDataSet(1);

    const dataSetId = PROOF_SET_ID_BYTES.toHex();
    assert.fieldEquals("DataSet", dataSetId, "status", "EMPTY");
    assert.fieldEquals("DataSet", dataSetId, "isActive", "true");
    assert.fieldEquals("DataSet", dataSetId, "nextDeadline", "0");
  });

  test("handlePiecesAdded transitions status from EMPTY to READY", () => {
    createAndSubmitDataSet(10);
    addRoots(11, 150);

    const dataSetId = PROOF_SET_ID_BYTES.toHex();
    assert.fieldEquals("DataSet", dataSetId, "status", "READY");
    assert.fieldEquals("DataSet", dataSetId, "isActive", "true");
  });

  test("handleNextProvingPeriod transitions status from READY to PROVING", () => {
    createAndSubmitDataSet(20);
    addRoots(21, 150);
    // challengeEpoch (440) is the contract's scheduled proof deadline, not
    // tx block + maxProvingPeriod. Store it verbatim.
    nextProvingPeriod(22, 200, 440);

    const dataSetId = PROOF_SET_ID_BYTES.toHex();
    assert.fieldEquals("DataSet", dataSetId, "status", "PROVING");
    assert.fieldEquals("DataSet", dataSetId, "isActive", "true");
    assert.fieldEquals("DataSet", dataSetId, "maxProvingPeriod", "240");
    assert.fieldEquals("DataSet", dataSetId, "nextDeadline", "440");
  });

  test("handleDataSetDeleted transitions status to DELETED", () => {
    createAndSubmitDataSet(30);
    addRoots(31, 150);

    const dataSetDeletedEvent = createDataSetDeletedEvent(
      SET_ID,
      BigInt.fromI32(32),
      CONTRACT_ADDRESS,
      BigInt.fromI32(200),
      BigInt.fromI32(1678886700),
      generateTxHash(32),
      BigInt.fromI32(0),
    );
    handleDataSetDeleted(dataSetDeletedEvent);

    const dataSetId = PROOF_SET_ID_BYTES.toHex();
    assert.fieldEquals("DataSet", dataSetId, "status", "DELETED");
    assert.fieldEquals("DataSet", dataSetId, "isActive", "false");
    assert.fieldEquals("DataSet", dataSetId, "nextDeadline", "0");
  });

  test("handleDataSetEmpty transitions status to EMPTY", () => {
    createAndSubmitDataSet(40);
    addRoots(41, 150);

    const dataSetEmptyEvent = createDataSetEmptyEvent(
      SET_ID,
      CONTRACT_ADDRESS,
      BigInt.fromI32(200),
      BigInt.fromI32(1678886700),
      generateTxHash(42),
      BigInt.fromI32(0),
    );
    handleDataSetEmpty(dataSetEmptyEvent);

    const dataSetId = PROOF_SET_ID_BYTES.toHex();
    assert.fieldEquals("DataSet", dataSetId, "status", "EMPTY");
    assert.fieldEquals("DataSet", dataSetId, "nextDeadline", "0");
    assert.fieldEquals("DataSet", dataSetId, "maxProvingPeriod", "0");
  });

  test("handleDataSetDeleted from PROVING status transitions to DELETED", () => {
    createAndSubmitDataSet(50);
    addRoots(51, 150);
    nextProvingPeriod(52, 200, 440);

    const dataSetId = PROOF_SET_ID_BYTES.toHex();
    assert.fieldEquals("DataSet", dataSetId, "status", "PROVING");

    const dataSetDeletedEvent = createDataSetDeletedEvent(
      SET_ID,
      BigInt.fromI32(32),
      CONTRACT_ADDRESS,
      BigInt.fromI32(250),
      BigInt.fromI32(1678886800),
      generateTxHash(53),
      BigInt.fromI32(0),
    );
    handleDataSetDeleted(dataSetDeletedEvent);

    assert.fieldEquals("DataSet", dataSetId, "status", "DELETED");
    assert.fieldEquals("DataSet", dataSetId, "isActive", "false");
  });

  test("Lifecycle: EMPTY → READY → PROVING → EMPTY → READY → PROVING", () => {
    // 1. Create (EMPTY)
    createAndSubmitDataSet(90);
    const dataSetId = PROOF_SET_ID_BYTES.toHex();
    assert.fieldEquals("DataSet", dataSetId, "status", "EMPTY");
    assert.fieldEquals("DataSet", dataSetId, "nextDeadline", "0");

    // 2. Add roots (READY)
    addRoots(91, 150);
    assert.fieldEquals("DataSet", dataSetId, "status", "READY");

    // 3. NextProvingPeriod (PROVING)
    nextProvingPeriod(92, 200, 440);
    assert.fieldEquals("DataSet", dataSetId, "status", "PROVING");
    assert.fieldEquals("DataSet", dataSetId, "nextDeadline", "440");

    // 4. DataSetEmpty (EMPTY) — resets deadline to 0 so next NPP re-seeds.
    const dataSetEmptyEvent = createDataSetEmptyEvent(
      SET_ID,
      CONTRACT_ADDRESS,
      BigInt.fromI32(250),
      BigInt.fromI32(1678886700),
      generateTxHash(93),
      BigInt.fromI32(0),
    );
    handleDataSetEmpty(dataSetEmptyEvent);
    assert.fieldEquals("DataSet", dataSetId, "status", "EMPTY");
    assert.fieldEquals("DataSet", dataSetId, "nextDeadline", "0");

    // 5. Add roots again (READY)
    const rootsEvent = createRootsAddedEvent(SET_ID, [BigInt.fromI32(201)], SENDER_ADDRESS, CONTRACT_ADDRESS);
    rootsEvent.block.number = BigInt.fromI32(300);
    rootsEvent.logIndex = BigInt.fromI32(1);
    rootsEvent.transaction.hash = generateTxHash(94);
    handlePiecesAdded(rootsEvent);
    assert.fieldEquals("DataSet", dataSetId, "status", "READY");

    // 6. NextProvingPeriod (PROVING) — first-init branch runs again since nextDeadline was zeroed.
    nextProvingPeriod(95, 350, 590);
    assert.fieldEquals("DataSet", dataSetId, "status", "PROVING");
    assert.fieldEquals("DataSet", dataSetId, "nextDeadline", "590");
    assert.fieldEquals("DataSet", dataSetId, "maxProvingPeriod", "240");
  });
});
