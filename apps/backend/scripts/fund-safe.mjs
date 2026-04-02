/**
 * Generate Safe multisig calldata for depositing USDFC into Filecoin Pay
 * and approving FWSS as an operator.
 *
 * Usage:
 *   node scripts/fund-safe.mjs --network mainnet|calibration --amount 50 --wallet-address 0x... [--output batch.json]
 *
 * Outputs a 3-transaction batch for the Safe Transaction Builder:
 *   1. USDFC.approve(FilecoinPay, amount)
 *   2. FilecoinPay.deposit(USDFC, walletAddress, amount)
 *   3. FilecoinPay.setOperatorApproval(USDFC, FWSS, true, maxUint256, maxUint256, maxUint256)
 *
 * Prerequisites: the multisig must hold USDFC tokens (ERC20 balance, not
 * Filecoin Pay balance). Transfer USDFC to the multisig first if needed.
 */

import { writeFileSync } from "fs";
import { calibration, mainnet } from "@filoz/synapse-core/chains";
import { encodeFunctionData, keccak256, parseUnits, stringToBytes } from "viem";

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const networkName = getArg("--network") || "calibration";
const amountStr = getArg("--amount");
const walletAddress = getArg("--wallet-address");
const outputFile = getArg("--output");

if (!amountStr) {
  console.error("--amount is required (e.g. --amount 50 for 50 USDFC)");
  process.exit(1);
}
if (!walletAddress) {
  console.error("--wallet-address is required (the multisig address to credit)");
  process.exit(1);
}

const chain = networkName === "mainnet" ? mainnet : calibration;
const amount = parseUnits(amountStr, 18);
const maxUint256 = 2n ** 256n - 1n;

const usdfcAddress = chain.contracts.usdfc.address;
const filecoinPayAddress = chain.contracts.filecoinPay.address;
const fwssAddress = chain.contracts.fwss.address;

// Transaction 1: ERC20 approve
const approveCalldata = encodeFunctionData({
  abi: [
    {
      type: "function",
      name: "approve",
      inputs: [
        { name: "spender", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [{ type: "bool" }],
      stateMutability: "nonpayable",
    },
  ],
  functionName: "approve",
  args: [filecoinPayAddress, amount],
});

// Transaction 2: deposit
const depositCalldata = encodeFunctionData({
  abi: chain.contracts.filecoinPay.abi,
  functionName: "deposit",
  args: [usdfcAddress, walletAddress, amount],
});

// Transaction 3: setOperatorApproval
const approveOperatorCalldata = encodeFunctionData({
  abi: chain.contracts.filecoinPay.abi,
  functionName: "setOperatorApproval",
  args: [usdfcAddress, fwssAddress, true, maxUint256, maxUint256, maxUint256],
});

const batch = {
  version: "1.0",
  chainId: String(chain.id),
  createdAt: Date.now(),
  meta: {
    name: "Transactions Batch",
    description: "",
    txBuilderVersion: "1.16.5",
    createdFromSafeAddress: walletAddress,
    createdFromOwnerAddress: "",
  },
  transactions: [
    {
      to: usdfcAddress,
      value: "0",
      data: approveCalldata,
      contractMethod: null,
      contractInputsValues: null,
    },
    {
      to: filecoinPayAddress,
      value: "0",
      data: depositCalldata,
      contractMethod: null,
      contractInputsValues: null,
    },
    {
      to: filecoinPayAddress,
      value: "0",
      data: approveOperatorCalldata,
      contractMethod: null,
      contractInputsValues: null,
    },
  ],
};

batch.meta.checksum = keccak256(stringToBytes(JSON.stringify(batch)));

console.log("=== Payment Setup for Safe Multisig ===");
console.log();
console.log(`Network:      ${networkName} (chain ${chain.id})`);
console.log(`Wallet:       ${walletAddress}`);
console.log(`Deposit:      ${amountStr} USDFC`);
console.log(`USDFC:        ${usdfcAddress}`);
console.log(`FilecoinPay:  ${filecoinPayAddress}`);
console.log(`FWSS:         ${fwssAddress}`);
console.log();
console.log("--- Transaction 1: Approve USDFC spend ---");
console.log(`Target: ${usdfcAddress}`);
console.log(`Value:  0`);
console.log(`Data:   ${approveCalldata}`);
console.log();
console.log("--- Transaction 2: Deposit into Filecoin Pay ---");
console.log(`Target: ${filecoinPayAddress}`);
console.log(`Value:  0`);
console.log(`Data:   ${depositCalldata}`);
console.log();
console.log("--- Transaction 3: Approve FWSS operator ---");
console.log(`Target: ${filecoinPayAddress}`);
console.log(`Value:  0`);
console.log(`Data:   ${approveOperatorCalldata}`);
console.log();
console.log("--- Safe Transaction Builder JSON ---");
if (outputFile) {
  writeFileSync(outputFile, JSON.stringify(batch, null, 3));
  console.log(`Saved to ${outputFile} — drag-and-drop into the Safe Transaction Builder.`);
} else {
  console.log("Save the following to a .json file and drag-and-drop into the Safe Transaction Builder.");
  console.log("Tip: use --output batch.json to write directly to a file and avoid copy-paste issues.");
  console.log();
  console.log(JSON.stringify(batch, null, 3));
}
console.log();
console.log("--- Safe UI Steps ---");
console.log("1. Go to safe.filecoin.io and open the multisig");
console.log("2. New Transaction > Transaction Builder");
console.log("3. Drag-and-drop the JSON file into the Transaction Builder (or create the transactions manually)");
console.log("4. Send Batch, review, sign, and collect required signatures");
console.log();
console.log("Note: The multisig must hold USDFC tokens before executing.");
console.log("Transfer USDFC to the multisig address first if needed.");
