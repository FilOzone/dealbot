/**
 * Shared Synapse instance creation for both DealService and WalletSdkService.
 *
 * Handles two modes:
 *   - Direct key: standard Synapse.create with privateKeyToAccount
 *   - Session key: uses a two-client pattern where the read client reports
 *     the multisig address as its account (so the SDK looks up datasets and
 *     balances for the right payer) while the session key client handles
 *     EIP-712 signing for write operations.
 *
 * The read client uses a custom transport that strips the `from` field on
 * eth_call and eth_estimateGas. This is necessary because:
 *   1. The SDK's Synapse client needs `client.account.address` set to the
 *      multisig so it can find datasets, check balances, and verify approvals
 *      for the correct payer.
 *   2. viem automatically includes `client.account.address` as the `from`
 *      field in eth_call RPC requests.
 *   3. Lotus currently rejects eth_call when `from` is a contract address
 *      (like a Safe multisig) with SysErrSenderInvalid.
 *
 * Stripping `from` makes the call anonymous, which Lotus accepts. The `from`
 * field is optional in eth_call and has no effect on the result for view
 * functions. See https://github.com/filecoin-project/lotus/pull/13470 for
 * the upstream fix that will make this workaround unnecessary.
 */

import * as SessionKey from "@filoz/synapse-core/session-key";
import { calibration, mainnet, Synapse } from "@filoz/synapse-sdk";
import { createClient, custom, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { IBlockchainConfig } from "../config/app.config.js";

export interface SynapseInstanceResult {
  synapse: Synapse;
  isSessionKeyMode: boolean;
}

/** Create a Synapse instance from blockchain config. See file-level docs. */
export async function createSynapseFromConfig(config: IBlockchainConfig): Promise<SynapseInstanceResult> {
  const chain = config.network === "mainnet" ? mainnet : calibration;
  const rpcUrl = config.rpcUrl;
  const transport = rpcUrl ? http(rpcUrl) : http();
  const sessionKeyPK = config.sessionKeyPrivateKey;

  if (sessionKeyPK) {
    const walletAddress = config.walletAddress as `0x${string}`;
    const sessionKey = SessionKey.fromSecp256k1({
      privateKey: sessionKeyPK,
      root: walletAddress,
      chain,
      transport,
    });
    await sessionKey.syncExpirations();

    const sessionKeyAccount = privateKeyToAccount(sessionKeyPK);
    const resolved = transport({ chain, retryCount: 0 });
    const safeReadTransport = custom({
      request: async (args) => {
        if (args.method === "eth_call" || args.method === "eth_estimateGas") {
          const params = [...(args.params || [])];
          if (params[0] && typeof params[0] === "object" && "from" in params[0]) {
            const { from: _, ...rest } = params[0];
            params[0] = rest;
          }
          return resolved.request({ ...args, params });
        }
        return resolved.request(args);
      },
    });

    const readClient = createClient({
      chain,
      transport: safeReadTransport,
      account: { ...sessionKeyAccount, address: walletAddress },
      name: "Synapse Read Client",
      key: "synapse-read-client",
    });

    return {
      synapse: new Synapse({
        client: readClient,
        sessionClient: sessionKey.client,
        source: "dealbot",
      }),
      isSessionKeyMode: true,
    };
  }

  return {
    synapse: Synapse.create({
      account: privateKeyToAccount(config.walletPrivateKey),
      chain,
      source: "dealbot",
      ...(rpcUrl ? { transport } : {}),
    }),
    isSessionKeyMode: false,
  };
}
