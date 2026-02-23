import Joi from "joi";
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
 * Options for fetching providers with datasets
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
 * A single proof set within a provider, representing deadline and fault data.
 * All numeric fields are bigints converted from the subgraph string representation.
 */
export type DataSet = {
  totalFaultedPeriods: bigint;
  currentDeadlineCount: bigint;
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
      number: Joi.number().required(),
    }).required(),
  }).required(),
}).required();

const dataSetSchema = Joi.object({
  totalFaultedPeriods: Joi.string().pattern(/^\d+$/).required().custom(toBigInt),
  currentDeadlineCount: Joi.string().pattern(/^\d+$/).required().custom(toBigInt),
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
 * Converts string fields in DataSet to bigint.
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
