import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { afterAll, assert, beforeAll, clearStore, describe, test } from "matchstick-as/assembly/index";
import { getRootEntityId, getRootSampleKey } from "../src/helpers";
import { handleDataSetCreated, handlePiecesAdded, handlePiecesAddedV2 } from "../src/pdp-verifier";
import { createDataSetCreatedEvent, createPiecesAddedV2Event, createRootsAddedEvent } from "./pdp-verifier-utils";

const SET_ID = BigInt.fromI32(1);
const ROOT_ID_1 = BigInt.fromI32(101);
const RAW_SIZE_1 = BigInt.fromI32(10486897);
const ROOT_CID_1_STR = "0x01559120258ff7f7021387dcea7164b7d1c4a98bd6f8d3c187e3114795efa391df307c8aa9d5d5cbac03";
const SENDER_ADDRESS = Address.fromString("0xa16081f360e3847006db660bae1c6d1b2e17ec2a");
const CONTRACT_ADDRESS = Address.fromString("0xb16081f360e3847006db660bae1c6d1b2e17ec2b");
const PROOF_SET_ID_BYTES = Bytes.fromBigInt(SET_ID);
const SET_ID_V2 = BigInt.fromI32(2);
const FIRST_PIECE_ID_V2 = BigInt.fromI32(200);
const SET_ID_BATCH = BigInt.fromI32(3);
const FIRST_PIECE_ID_BATCH = BigInt.fromI32(300);
const PIECE_COUNT = 3;

describe("handlePiecesAdded Tests", () => {
  beforeAll(() => {
    const mockDataSetCreatedEvent = createDataSetCreatedEvent(
      SET_ID,
      SENDER_ADDRESS,
      Bytes.fromI32(123),
      CONTRACT_ADDRESS,
      BigInt.fromI32(50),
      BigInt.fromI32(1678886400),
    );
    handleDataSetCreated(mockDataSetCreatedEvent);

    const rootsAddedEvent = createRootsAddedEvent(SET_ID, [ROOT_ID_1], SENDER_ADDRESS, CONTRACT_ADDRESS);
    rootsAddedEvent.block.timestamp = BigInt.fromI32(100);
    rootsAddedEvent.block.number = BigInt.fromI32(50);
    rootsAddedEvent.logIndex = BigInt.fromI32(1);
    rootsAddedEvent.transaction.hash = Bytes.fromHexString(`0x${"c".repeat(64)}`);

    handlePiecesAdded(rootsAddedEvent);
  });

  afterAll(() => {
    clearStore();
  });

  test("DataSet, Provider, and Root are created with the expected fields", () => {
    assert.entityCount("DataSet", 1);
    assert.entityCount("Root", 1);
    assert.entityCount("Provider", 1);

    const dataSetId = PROOF_SET_ID_BYTES.toHex();
    assert.fieldEquals("DataSet", dataSetId, "setId", SET_ID.toString());
    assert.fieldEquals("DataSet", dataSetId, "status", "READY");
    assert.fieldEquals("DataSet", dataSetId, "isActive", "true");
    assert.fieldEquals("DataSet", dataSetId, "owner", SENDER_ADDRESS.toHex());

    const rootEntityIdBytes = getRootEntityId(SET_ID, ROOT_ID_1);
    const rootEntityId = rootEntityIdBytes.toHex();
    assert.fieldEquals("Root", rootEntityId, "rootId", ROOT_ID_1.toString());
    assert.fieldEquals("Root", rootEntityId, "setId", SET_ID.toString());
    assert.fieldEquals("Root", rootEntityId, "cid", ROOT_CID_1_STR);
    assert.fieldEquals("Root", rootEntityId, "rawSize", RAW_SIZE_1.toString());
    assert.fieldEquals("Root", rootEntityId, "removed", "false");
    assert.fieldEquals("Root", rootEntityId, "sampleKey", getRootSampleKey(rootEntityIdBytes).toHex());

    const providerId = SENDER_ADDRESS.toHex();
    assert.fieldEquals("Provider", providerId, "address", providerId);
    assert.fieldEquals("Provider", providerId, "totalFaultedPeriods", "0");
    assert.fieldEquals("Provider", providerId, "totalProvingPeriods", "0");
  });
});

describe("handlePiecesAddedV2 Tests", () => {
  beforeAll(() => {
    const mockDataSetCreatedEvent = createDataSetCreatedEvent(
      SET_ID_V2,
      SENDER_ADDRESS,
      Bytes.fromI32(123),
      CONTRACT_ADDRESS,
      BigInt.fromI32(50),
      BigInt.fromI32(1678886400),
    );
    handleDataSetCreated(mockDataSetCreatedEvent);

    const piecesAddedV2Event = createPiecesAddedV2Event(
      SET_ID_V2,
      FIRST_PIECE_ID_V2,
      1,
      SENDER_ADDRESS,
      CONTRACT_ADDRESS,
    );
    piecesAddedV2Event.block.timestamp = BigInt.fromI32(100);
    piecesAddedV2Event.block.number = BigInt.fromI32(50);
    piecesAddedV2Event.logIndex = BigInt.fromI32(1);
    piecesAddedV2Event.transaction.hash = Bytes.fromHexString(`0x${"d".repeat(64)}`);

    handlePiecesAddedV2(piecesAddedV2Event);
  });

  afterAll(() => {
    clearStore();
  });

  test("Packed CID is reconstructed and Root/DataSet fields match the legacy PiecesAdded shape", () => {
    assert.entityCount("DataSet", 1);
    assert.entityCount("Root", 1);
    assert.entityCount("Provider", 1);

    const dataSetId = Bytes.fromBigInt(SET_ID_V2).toHex();
    assert.fieldEquals("DataSet", dataSetId, "status", "READY");

    const rootEntityIdBytes = getRootEntityId(SET_ID_V2, FIRST_PIECE_ID_V2);
    const rootEntityId = rootEntityIdBytes.toHex();
    assert.fieldEquals("Root", rootEntityId, "rootId", FIRST_PIECE_ID_V2.toString());
    assert.fieldEquals("Root", rootEntityId, "setId", SET_ID_V2.toString());
    assert.fieldEquals("Root", rootEntityId, "cid", ROOT_CID_1_STR);
    assert.fieldEquals("Root", rootEntityId, "rawSize", RAW_SIZE_1.toString());
    assert.fieldEquals("Root", rootEntityId, "removed", "false");
    assert.fieldEquals("Root", rootEntityId, "sampleKey", getRootSampleKey(rootEntityIdBytes).toHex());
  });
});

describe("handlePiecesAddedV2 contiguous piece ids Tests", () => {
  beforeAll(() => {
    const mockDataSetCreatedEvent = createDataSetCreatedEvent(
      SET_ID_BATCH,
      SENDER_ADDRESS,
      Bytes.fromI32(123),
      CONTRACT_ADDRESS,
      BigInt.fromI32(50),
      BigInt.fromI32(1678886400),
    );
    handleDataSetCreated(mockDataSetCreatedEvent);

    const piecesAddedV2Event = createPiecesAddedV2Event(
      SET_ID_BATCH,
      FIRST_PIECE_ID_BATCH,
      PIECE_COUNT,
      SENDER_ADDRESS,
      CONTRACT_ADDRESS,
    );
    handlePiecesAddedV2(piecesAddedV2Event);
  });

  afterAll(() => {
    clearStore();
  });

  test("piece ids derive from firstPieceId + array index", () => {
    assert.entityCount("Root", PIECE_COUNT);

    for (let i = 0; i < PIECE_COUNT; i++) {
      const rootId = FIRST_PIECE_ID_BATCH.plus(BigInt.fromI32(i));
      const rootEntityId = getRootEntityId(SET_ID_BATCH, rootId).toHex();
      assert.fieldEquals("Root", rootEntityId, "rootId", rootId.toString());
      assert.fieldEquals("Root", rootEntityId, "setId", SET_ID_BATCH.toString());
    }

    const dataSetId = Bytes.fromBigInt(SET_ID_BATCH).toHex();
    assert.fieldEquals("DataSet", dataSetId, "status", "READY");
  });
});
