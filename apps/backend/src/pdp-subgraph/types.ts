import Joi from "joi";
import { CID } from "multiformats/cid";
import { Hex, isAddress } from "viem";

// -----------------------------------------
// Types
// -----------------------------------------

/** The response from the subgraph GraphQL query */
export type GraphQLResponse = {
  /** The data from the query */
  data?: unknown;
  /** The errors from the query */
  errors?: { message: string }[];
};

/**
 * Options for fetching providers with data sets
 */
export type ProvidersWithDataSetsOptions = {
  addresses: string[];
  blockNumber: number;
};

/**
 * Validated response from the PDP subgraph meta query.
 */
export type SubgraphMeta = {
  _meta: {
    block: {
      number: number;
    };
  };
};

/**
 * A single proof set within a provider, representing deadline-related proving data.
 * All numeric fields are bigints converted from the subgraph string representation.
 */
export type DataSet = {
  nextDeadline: bigint;
  maxProvingPeriod: bigint;
};

/**
 * Validated and transformed response from the PDP subgraph providers query.
 * Numeric fields are converted from subgraph string representation to bigint.
 */
export type ProviderDataSetResponse = {
  providers: {
    address: Hex;
    totalFaultedPeriods: bigint;
    totalProvingPeriods: bigint;
    proofSets: DataSet[];
  }[];
};

/** A piece eligible for anonymous retrieval. */
export type FwssCandidatePiece = {
  /** Decoded piece CID string (e.g. "bafk..."). */
  pieceCid: string;
  /** On-chain piece ID (rootId) as a decimal string. */
  pieceId: string;
  /** On-chain dataset ID (setId) as a decimal string. */
  dataSetId: string;
  /** Raw piece size in bytes, as a decimal string. */
  rawSize: string;
  /** True iff the parent dataset declared withIPFSIndexing metadata. */
  withIPFSIndexing: boolean;
  /** IPFS root CID declared by the client when uploading, or null. */
  ipfsRootCid: string | null;
};

/**
 * Validated raw shape of the FWSS candidate-pieces subgraph response.
 * Consumers should prefer the parsed FwssCandidatePiece[] output.
 */
export type RawCandidatePiecesResponse = {
  _meta: { block: { number: number } };
  dataSets: Array<{
    setId: string;
    withIPFSIndexing: boolean;
    pdpPaymentEndEpoch: string | null;
    roots: Array<{
      rootId: string;
      cid: string;
      rawSize: string;
      ipfsRootCID: string | null;
    }>;
  }>;
};

// -----------------------------------------
// Helpers
// -----------------------------------------

/**
 * Decodes a hex-encoded CID (0x...) into its string representation.
 */
export function decodePieceCid(hexData: string): string {
  const bytes = Buffer.from(hexData.slice(2), "hex");
  return CID.decode(new Uint8Array(bytes)).toString();
}

// -----------------------------------------
// Joi Custom Schema Converters
// -----------------------------------------

/** Joi custom validator that converts a numeric string to bigint. */
const toBigInt = (value: unknown, helpers: Joi.CustomHelpers) => {
  try {
    return BigInt(value as string);
  } catch {
    return helpers.error("any.invalid", {
      message: "Invalid bigint value",
    });
  }
};

/** Joi custom validator to validate an Ethereum address and normalize to lowercase. */
const toEthereumAddress = (value: unknown, helpers: Joi.CustomHelpers) => {
  if (!isAddress(value as string)) {
    return helpers.error("any.invalid", { message: "Invalid Ethereum address" });
  }

  // Normalize to lowercase for consistent key lookups
  return (value as string).toLowerCase() as Hex;
};

// -----------------------------------------
// Joi Schemas
// -----------------------------------------

const metaSchema = Joi.object({
  _meta: Joi.object({
    block: Joi.object({
      number: Joi.number().integer().positive().required(),
    })
      .unknown(true)
      .required(),
  })
    .unknown(true)
    .required(),
})
  .unknown(true)
  .required();

const dataSetSchema = Joi.object({
  nextDeadline: Joi.string().pattern(/^\d+$/).required().custom(toBigInt),
  maxProvingPeriod: Joi.string().pattern(/^\d+$/).required().custom(toBigInt),
}).unknown(true);

const providerDataSetResponseSchema = Joi.object({
  providers: Joi.array()
    .items(
      Joi.object({
        address: Joi.string().required().custom(toEthereumAddress),
        totalFaultedPeriods: Joi.string().pattern(/^\d+$/).required().custom(toBigInt),
        totalProvingPeriods: Joi.string().pattern(/^\d+$/).required().custom(toBigInt),
        proofSets: Joi.array().items(dataSetSchema).required(),
      }).unknown(true),
    )
    .required(),
})
  .unknown(true)
  .required();

const candidateRootSchema = Joi.object({
  rootId: Joi.string().pattern(/^\d+$/).required(),
  cid: Joi.string()
    .pattern(/^0x[0-9a-fA-F]+$/)
    .required(),
  rawSize: Joi.string().pattern(/^\d+$/).required(),
  ipfsRootCID: Joi.string().allow(null).optional(),
}).unknown(true);

const candidateDataSetSchema = Joi.object({
  setId: Joi.string().pattern(/^\d+$/).required(),
  withIPFSIndexing: Joi.boolean().required(),
  pdpPaymentEndEpoch: Joi.string().pattern(/^\d+$/).allow(null).optional(),
  roots: Joi.array().items(candidateRootSchema).required(),
}).unknown(true);

const candidatePiecesResponseSchema = Joi.object({
  _meta: Joi.object({
    block: Joi.object({
      number: Joi.number().integer().positive().required(),
    })
      .unknown(true)
      .required(),
  })
    .unknown(true)
    .required(),
  dataSets: Joi.array().items(candidateDataSetSchema).required(),
})
  .unknown(true)
  .required();

// -----------------------------------------
// Validator Functions
// -----------------------------------------

/**
 * Validates a raw subgraph meta response into SubgraphMeta.
 *
 * @param value - The raw parsed JSON from the subgraph
 * @throws Error if validation fails
 */
export function validateSubgraphMetaResponse(value: unknown): SubgraphMeta {
  const { error, value: validated } = metaSchema.validate(value, { abortEarly: false });
  if (error) {
    throw new Error(`Invalid subgraph meta response format: ${error.message}`);
  }
  return validated as SubgraphMeta;
}

/**
 * Validates and transforms a raw subgraph response into ProviderDataSetResponse.
 * Converts string fields to bigint.
 *
 * @param value - The raw parsed JSON from the subgraph
 * @throws Error if validation fails
 */
export function validateProviderDataSetResponse(value: unknown): ProviderDataSetResponse {
  const { error, value: validated } = providerDataSetResponseSchema.validate(value, { abortEarly: false });
  if (error) {
    throw new Error(`Invalid provider dataset response format: ${error.message}`);
  }
  return validated as ProviderDataSetResponse;
}

/**
 * Validates the raw FWSS candidate-pieces response from the subgraph.
 *
 * @throws Error if validation fails
 */
export function validateCandidatePiecesResponse(value: unknown): RawCandidatePiecesResponse {
  const { error, value: validated } = candidatePiecesResponseSchema.validate(value, { abortEarly: false });
  if (error) {
    throw new Error(`Invalid candidate pieces response format: ${error.message}`);
  }
  return validated as RawCandidatePiecesResponse;
}
