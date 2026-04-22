import { Address, BigInt, Bytes, crypto } from "@graphprotocol/graph-ts";

// ---- Entity ID helpers ----------------------------------------------------

export function getProofSetEntityId(setId: BigInt): Bytes {
  return Bytes.fromByteArray(Bytes.fromBigInt(setId));
}

export function getRootEntityId(setId: BigInt, rootId: BigInt): Bytes {
  return Bytes.fromUTF8(setId.toString() + "-" + rootId.toString());
}

// Uniform pseudorandom sort key for Root entities. Used by dealbot to draw
// random pieces fairly via `orderBy: sampleKey, where: { sampleKey_gte: X }`,
// which needs a key distributed independently of setId/rootId.
export function getRootSampleKey(rootEntityId: Bytes): Bytes {
  return Bytes.fromByteArray(crypto.keccak256(rootEntityId));
}

// ---- FWSS metadata helpers ------------------------------------------------

export function arrayContains(arr: string[], needle: string): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] == needle) return true;
  }
  return false;
}

export function extractMetadataValue(keys: string[], values: string[], needle: string): string | null {
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] == needle) {
      return i < values.length ? values[i] : null;
    }
  }
  return null;
}

// ---- Per-network proving period ------------------------------------------
//
// NextProvingPeriod is emitted by the PDPVerifier, so event.address on that
// handler is the PDPVerifier contract. Each subgraph build targets a single
// network, so only the matching branch is live for a given deployment — the
// others are dead code on that build, kept explicit here so the mapping is
// discoverable in one place rather than hidden behind a build-time constant.
//   mainnet:     MaxProvingPeriod = 2880
//   calibration: MaxProvingPeriod = 240

const MAINNET_PDP_VERIFIER = Address.fromString("0xBADd0B92C1c71d02E7d520f64c0876538fa2557F");
const CALIBRATION_PDP_VERIFIER = Address.fromString("0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C");

export function maxProvingPeriodFor(pdpVerifier: Address): i32 {
  if (pdpVerifier.equals(MAINNET_PDP_VERIFIER)) return 2880;
  if (pdpVerifier.equals(CALIBRATION_PDP_VERIFIER)) return 240;
  // Conservative fallback for unknown deployments (matches calibration).
  return 240;
}

// ---- CommP v2 CID decoding ------------------------------------------------

export const COMMP_V2_PREFIX: u8[] = [0x01, 0x55, 0x91, 0x20];

export class CommPv2ValidationResult {
  constructor(
    public isValid: boolean,
    public padding: BigInt = BigInt.zero(),
    public height: u8 = 0,
    public digestOffset: BigInt = BigInt.zero(),
  ) {}
}

export class UvarintResult {
  constructor(
    public isValid: boolean,
    public value: BigInt = BigInt.zero(),
    public offset: BigInt = BigInt.zero(),
  ) {}
}

export function readUvarint(data: Bytes, offset: BigInt): UvarintResult {
  let offsetU32 = offset.toU32();

  if (offsetU32 >= u32(data.length)) {
    return new UvarintResult(false);
  }

  let i: u32 = 0;
  let value: u64 = u64(data[offsetU32] & 0x7f);

  while (data[offsetU32 + i] >= 0x80) {
    i++;

    if (offsetU32 + i >= u32(data.length)) {
      return new UvarintResult(false);
    }

    if (i >= 10) {
      return new UvarintResult(false);
    }

    let nextByte = u64(data[offsetU32 + i] & 0x7f);
    value = value | (nextByte << (i * 7));
  }

  i++;
  return new UvarintResult(true, BigInt.fromU64(value), BigInt.fromU32(offsetU32 + i));
}

export function validateCommPv2(cidData: Bytes): CommPv2ValidationResult {
  if (cidData.length < 4) {
    return new CommPv2ValidationResult(false);
  }

  for (let i: i32 = 0; i < 4; i++) {
    if (cidData[i] != COMMP_V2_PREFIX[i]) {
      return new CommPv2ValidationResult(false);
    }
  }

  let offset = BigInt.fromU32(4);

  if (offset.toU32() >= u32(cidData.length)) {
    return new CommPv2ValidationResult(false);
  }

  let mhLengthResult = readUvarint(cidData, offset);
  if (!mhLengthResult.isValid) {
    return new CommPv2ValidationResult(false);
  }

  let mhLength = mhLengthResult.value;
  offset = mhLengthResult.offset;

  if (mhLength.lt(BigInt.fromU32(34))) {
    return new CommPv2ValidationResult(false);
  }

  if (mhLength.plus(offset).notEqual(BigInt.fromU32(cidData.length))) {
    return new CommPv2ValidationResult(false);
  }

  if (offset.toU32() >= u32(cidData.length)) {
    return new CommPv2ValidationResult(false);
  }

  let paddingResult = readUvarint(cidData, offset);
  if (!paddingResult.isValid) {
    return new CommPv2ValidationResult(false);
  }

  let padding = paddingResult.value;
  offset = paddingResult.offset;

  if (offset.toU32() >= u32(cidData.length)) {
    return new CommPv2ValidationResult(false);
  }

  let height = cidData[offset.toU32()];
  offset = offset.plus(BigInt.fromU32(1));

  return new CommPv2ValidationResult(true, padding, height, offset);
}

export function unpaddedSize(padding: BigInt, height: u8): BigInt {
  if (height > 58) {
    return BigInt.zero();
  }

  const baseSize = BigInt.fromU32(127).leftShift(height - 2);

  if (padding.gt(baseSize)) {
    return BigInt.zero();
  }

  return baseSize.minus(padding);
}
