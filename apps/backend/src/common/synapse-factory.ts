/**
 * Shared Synapse instance creation for both DealService and WalletSdkService.
 *
 * Handles two modes:
 *   - Direct key: standard Synapse.create with privateKeyToAccount
 *   - Session key: custom transport that strips `from` on eth_call to work
 *     around Lotus rejecting reads from contract addresses (Safe multisig).
 *     See https://github.com/filecoin-project/lotus/pull/13470
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

/**
 * Create a Synapse instance from blockchain config.
 *
 * In session key mode, builds a read client with the multisig address as
 * account.address (so the SDK uses it for payer lookups) but strips `from`
 * on eth_call/eth_estimateGas (so Lotus accepts reads from a contract
 * address). Write operations go through the session key's client.
 */
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
