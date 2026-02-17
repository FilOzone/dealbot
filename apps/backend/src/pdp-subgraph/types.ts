import Joi from "joi";
import { Hex, isAddress } from "viem";

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
export interface IProviderDataSetResponse {
  providers: {
    address: Hex;
    totalFaultedPeriods: bigint;
    totalProvingPeriods: bigint;
    proofSets: DataSet[];
  }[];
}

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

/** Joi custom validator to validate ethereum Address */
const toEthereumAddress = (value: unknown, helpers: Joi.CustomHelpers) => {
  if (!isAddress(value as string)) {
    return helpers.error("any.invalid", { message: "Invalid Ethereum address" });
  }
  return value as Hex;
};

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

/**
 * Validates and transforms a raw subgraph response into IProviderDataSetResponse.
 * Converts string fields in DataSet to bigint.
 *
 * @param value - The raw parsed JSON from the subgraph
 * @throws Error if validation fails
 */
export function validateProviderDataSetResponse(value: unknown): IProviderDataSetResponse {
  const { error, value: validated } = providerDataSetResponseSchema.validate(value, { abortEarly: false });
  if (error) {
    throw new Error(`Invalid provider dataset response format: ${error.message}`);
  }
  return validated as IProviderDataSetResponse;
}
