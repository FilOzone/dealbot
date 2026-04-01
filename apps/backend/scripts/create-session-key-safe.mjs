/**
 * Generate a session key and Safe multisig calldata for registering it
 * on the SessionKeyRegistry contract.
 *
 * Usage:
 *   node scripts/create-session-key-safe.mjs [--network mainnet|calibration] [--expiry-days 90] [--session-key 0x...]
 *
 * If --session-key is omitted, a random key is generated.
 *
 * Outputs:
 *   1. Session key address and private key
 *   2. Permission hashes being registered
 *   3. Safe transaction details (target, calldata, value)
 *   4. Verification: decoded calldata for review
 *   5. Env vars for DealBot deployment
 *
 * The calldata should be submitted as a custom transaction in the Safe UI
 * (app.safe.global) from the DealBot multisig wallet.
 */

import { calibration, mainnet } from "@filoz/synapse-core/chains";
import {
  AddPiecesPermission,
  CreateDataSetPermission,
  DefaultFwssPermissions,
  DeleteDataSetPermission,
  loginCall,
  SchedulePieceRemovalsPermission,
} from "@filoz/synapse-core/session-key";
import { decodeFunctionData, encodeFunctionData } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const networkName = getArg("--network") || "calibration";
const expiryDays = Number(getArg("--expiry-days") || "90");
const sessionPrivateKey = getArg("--session-key") || generatePrivateKey();

const chain = networkName === "mainnet" ? mainnet : calibration;
const sessionAccount = privateKeyToAccount(sessionPrivateKey);
const expiresAt = BigInt(Math.floor(Date.now() / 1000) + expiryDays * 24 * 60 * 60);
const expiryDate = new Date(Number(expiresAt) * 1000);

// Use the SDK's loginCall to get the exact ABI and args
const call = loginCall({
  chain,
  address: sessionAccount.address,
  permissions: DefaultFwssPermissions,
  expiresAt,
  origin: "dealbot",
});

// Encode the calldata
const calldata = encodeFunctionData({
  abi: call.abi,
  functionName: call.functionName,
  args: call.args,
});

// Verify by decoding it back
const decoded = decodeFunctionData({
  abi: call.abi,
  data: calldata,
});

// Permission labels for display
const permissionLabels = {
  [CreateDataSetPermission]: "CreateDataSet",
  [AddPiecesPermission]: "AddPieces",
  [SchedulePieceRemovalsPermission]: "SchedulePieceRemovals",
  [DeleteDataSetPermission]: "DeleteDataSet",
};

// Output
console.log("=== Session Key Registration for Safe Multisig ===");
console.log();
console.log(`Network:            ${networkName} (chain ${chain.id})`);
console.log(`Session key addr:   ${sessionAccount.address}`);
console.log(`Expiry:             ${expiryDate.toISOString()} (${expiryDays} days)`);
console.log(`Origin:             dealbot`);
console.log();
console.log("--- Permissions ---");
for (const hash of DefaultFwssPermissions) {
  console.log(`  ${permissionLabels[hash] || "Unknown"}: ${hash}`);
}
console.log();
console.log("--- Safe Transaction ---");
console.log(`Target (SessionKeyRegistry): ${call.address}`);
console.log(`Value: 0`);
console.log(`Calldata:`);
console.log(calldata);
console.log();
console.log("--- Verification (decoded calldata) ---");
console.log(`Function: ${decoded.functionName}`);
console.log(`Args:`);
console.log(`  signer:      ${decoded.args[0]}`);
console.log(`  expiry:      ${decoded.args[1]} (${new Date(Number(decoded.args[1]) * 1000).toISOString()})`);
console.log(`  permissions: [`);
for (const p of decoded.args[2]) {
  console.log(`    ${p} (${permissionLabels[p] || "Unknown"})`);
}
console.log(`  ]`);
console.log(`  origin:      "${decoded.args[3]}"`);
console.log();
console.log("--- Safe UI Steps ---");
console.log("1. Go to safe.filecoin.io and open the DealBot multisig");
console.log("2. New Transaction > Transaction Builder");
console.log(`3. Enter contract address: ${call.address}`);
console.log('4. Select "Custom data (hex encoded)"');
console.log("5. Paste the calldata above");
console.log("6. Value: 0");
console.log("7. Review, sign, and collect required signatures");
console.log();
console.log("--- DealBot Env Vars (for SOPS secrets) ---");
console.log(`SESSION_KEY_PRIVATE_KEY=${sessionPrivateKey}`);
console.log();
console.log("--- Renewal ---");
console.log("To renew, run this script again with the same --session-key");
console.log("and submit the new calldata via Safe. The contract overwrites");
console.log("the previous registration for the same signer address.");
