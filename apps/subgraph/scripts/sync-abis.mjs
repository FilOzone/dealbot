#!/usr/bin/env node
// Writes contract ABIs consumed by graph-cli from the canonical
// @filoz/synapse-core package into apps/subgraph/abis/*.json. Running this
// before `graph codegen` keeps the subgraph in lock-step with the source of
// truth; bumping the synapse-core version is all that's needed to pick up
// ABI changes.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fwss, pdp } from "@filoz/synapse-core/abis";

const here = dirname(fileURLToPath(import.meta.url));
const abisDir = join(here, "..", "abis");

// TODO(https://github.com/FilOzone/dealbot/issues/683): PDPVerifier PR
// https://github.com/FilOzone/pdp/pull/300 adds a compact PiecesAddedV2 event
// but hasn't been merged/deployed/picked up by synapse-core yet, so it's
// still missing from the fetched ABI. Inject it by hand so codegen produces
// the handlePiecesAddedV2 bindings; drop this once synapse-core ships it
// natively (`pdp.some(e => e.name === "PiecesAddedV2")` will start passing).
const PIECES_ADDED_V2_EVENT = {
  type: "event",
  name: "PiecesAddedV2",
  inputs: [
    { name: "setId", type: "uint256", indexed: true, internalType: "uint256" },
    { name: "firstPieceId", type: "uint256", indexed: false, internalType: "uint256" },
    {
      name: "pieceCids",
      type: "tuple[]",
      indexed: false,
      internalType: "struct Cids.PackedCid[]",
      components: [
        { name: "header", type: "bytes32", internalType: "bytes32" },
        { name: "root", type: "bytes32", internalType: "bytes32" },
      ],
    },
  ],
  anonymous: false,
};

const pdpPatched = pdp.some((entry) => entry.name === "PiecesAddedV2") ? pdp : [...pdp, PIECES_ADDED_V2_EVENT];

const targets = [
  { file: "PDPVerifier.json", abi: pdpPatched },
  { file: "FilecoinWarmStorageService.json", abi: fwss },
];

await mkdir(abisDir, { recursive: true });

for (const { file, abi } of targets) {
  const outPath = join(abisDir, file);
  await writeFile(outPath, `${JSON.stringify(abi, null, 2)}\n`);
  console.log(`wrote ${outPath} (${abi.length} entries)`);
}
