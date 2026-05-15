// Asserts apps/subgraph/networks.json stays in sync with the contract
// addresses shipped by @filoz/synapse-core (which is generated from
// FilOzone/filecoin-services). Bumping synapse-core is the trigger for any
// address change; this test fails fast if networks.json drifts.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generated } from "@filoz/synapse-core/abis";

const { filecoinWarmStorageServiceAddress, pdpVerifierAddress } = generated;

const here = dirname(fileURLToPath(import.meta.url));
const networksPath = join(here, "..", "networks.json");
const networks = JSON.parse(await readFile(networksPath, "utf8"));

const cases = {
  "filecoin": 314,
  "filecoin-testnet": 314159,
};

for (const [network, chainId] of Object.entries(cases)) {
  test(`${network} PDPVerifier address matches synapse-core[${chainId}]`, () => {
    const actual = networks[network]?.PDPVerifier?.address;
    const expected = pdpVerifierAddress[chainId];
    assert.equal(actual, expected, `expected ${expected}, got ${actual} for ${network}.PDPVerifier.address`)
  });

  test(`${network} FilecoinWarmStorageService address matches synapse-core[${chainId}]`, () => {
    const actual = networks[network]?.FilecoinWarmStorageService?.address;
    const expected = filecoinWarmStorageServiceAddress[chainId];
    assert.equal(actual, expected, `expected ${expected}, got ${actual} for ${network}.FilecoinWarmStorageService.address`);
  });
}