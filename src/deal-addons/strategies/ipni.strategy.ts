import { request } from "node:https";
import { Readable } from "node:stream";
import { METADATA_KEYS, PDPServer } from "@filoz/synapse-sdk";
import { CarWriter } from "@ipld/car";
import { Injectable, Logger } from "@nestjs/common";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";
import { MAX_BLOCK_SIZE } from "../../common/constants.js";
import type { Deal } from "../../database/entities/deal.entity.js";
import type { DealMetadata, IpniMetadata } from "../../database/types.js";
import { ServiceType } from "../../database/types.js";
import type { IDealAddon } from "../interfaces/deal-addon.interface.js";
import type {
  AddonExecutionContext,
  CarDataFile,
  DealConfiguration,
  IpniPreprocessingResult,
  SynapseConfig,
} from "../types.js";
import { AddonPriority } from "../types.js";

/**
 * IPNI (InterPlanetary Network Indexer) add-on strategy
 * Converts data to CAR format for IPFS indexing and retrieval
 * This is a data transformation add-on that runs with high priority
 */
@Injectable()
export class IpniAddonStrategy implements IDealAddon<IpniMetadata> {
  private readonly logger = new Logger(IpniAddonStrategy.name);

  readonly name = ServiceType.IPFS_PIN;
  readonly priority = AddonPriority.HIGH; // Run first to transform data
  readonly POLLING_INTERVAL_MS = 2500;
  readonly POLLING_TIMEOUT_MS = 10 * 60 * 1000;
  readonly IPNI_LOOKUP_TIMEOUT_MS = 60 * 60 * 1000;

  /**
   * Check if IPNI is enabled in the deal configuration
   */
  isApplicable(config: DealConfiguration): boolean {
    return config.enableIpni;
  }

  /**
   * Convert data to CAR format for IPNI indexing
   * This is the main preprocessing step that transforms the data
   */
  async preprocessData(context: AddonExecutionContext): Promise<IpniPreprocessingResult> {
    this.logger.log(`Converting file to CAR format for IPNI: ${context.currentData.name}`);

    try {
      const carResult = await this.convertToCar(context.currentData);

      this.logger.log(
        `CAR conversion completed: ${carResult.blockCount} blocks, ` +
          `${carResult.carSize} bytes (original: ${context.currentData.size} bytes)`,
      );

      const metadata: IpniMetadata = {
        enabled: true,
        rootCID: carResult.rootCID.toString(),
        blockCIDs: carResult.blockCIDs.map((cid) => cid.toString()),
        blockCount: carResult.blockCount,
        carSize: carResult.carSize,
        originalSize: context.currentData.size,
      };

      return {
        metadata,
        data: carResult.carData,
        size: carResult.carSize,
        originalData: context.currentData.data,
      };
    } catch (error) {
      this.logger.error(`CAR conversion failed for ${context.currentData.name}`, error);
      throw new Error(`IPNI preprocessing failed: ${error.message}`);
    }
  }

  /**
   * Configure Synapse SDK to enable IPNI
   */
  getSynapseConfig(dealMetadata?: DealMetadata): SynapseConfig {
    if (!dealMetadata?.[this.name]) {
      return {
        metadata: {},
      };
    }

    const rootCID = dealMetadata[this.name]?.rootCID;
    if (!rootCID) {
      return {
        metadata: {},
      };
    }

    return {
      metadata: {
        [METADATA_KEYS.WITH_IPFS_INDEXING]: "",
        [METADATA_KEYS.IPFS_ROOT_CID]: rootCID,
      },
    };
  }

  serviceURLToMultiaddr(serviceURL: string) {
    try {
      const url = new URL(serviceURL);
      const hostname = url.hostname;
      const protocol = url.protocol.replace(":", "");
      if (protocol !== "https") {
        throw new Error(`Only HTTPS protocol is supported for PDP serviceURL, got: ${protocol}`);
      }
      return `/dns/${hostname}/tcp/443/https`;
    } catch (error) {
      throw new Error(`Failed to convert serviceURL to multiaddr: ${error.message}`);
    }
  }

  /**
   * Post-process to verify IPNI indexing
   */
  async postProcess(deal: Deal): Promise<void> {
    this.logger.log(
      `Verifying IPNI indexing for deal with pieceCid: ${deal.pieceCid} and rootCID: ${
        deal.metadata[this.name]?.rootCID
      }`,
    );

    if (!deal.storageProvider) return;
    const pdpServer = new PDPServer(null, deal.storageProvider.serviceUrl);

    const expectedMultiaddr = this.serviceURLToMultiaddr(deal.storageProvider.serviceUrl);
    await this.monitorAndVerifyIPNI(
      pdpServer,
      deal.pieceCid,
      deal.metadata[this.name]?.blockCIDs ?? [],
      expectedMultiaddr,
      this.POLLING_TIMEOUT_MS,
      this.IPNI_LOOKUP_TIMEOUT_MS,
      this.POLLING_INTERVAL_MS,
    );
  }

  async monitorPieceStatus(pdpServer: PDPServer, pieceCid: string, maxDurationMs: number, pollIntervalMs: number) {
    this.logger.log(`Starting status monitoring (pieceCid: ${pieceCid})`, "STATUS");

    const startTime = Date.now();
    let lastStatus: {
      status: string;
      indexed: boolean;
      advertised: boolean;
      retrieved: boolean;
      retrievedAt?: string | null;
    } = {
      status: "",
      indexed: false,
      advertised: false,
      retrieved: false,
      retrievedAt: null,
    };
    let checkCount = 0;

    while (Date.now() - startTime < maxDurationMs) {
      checkCount++;

      try {
        const status = await pdpServer.getPieceStatus(pieceCid);

        // Log changes only
        if (status.status !== lastStatus.status) {
          this.logger.log(`Status changed: ${lastStatus.status || "unknown"} → ${status.status}`, "STATUS");
        }
        if (status.indexed !== lastStatus.indexed) {
          this.logger.log(`✓ Indexed: ${status.indexed}`, "STATUS");
        }
        if (status.advertised !== lastStatus.advertised) {
          this.logger.log(`✓ Advertised: ${status.advertised}`, "STATUS");
        }
        if (status.retrieved !== lastStatus.retrieved) {
          this.logger.log(`✓ Retrieved: ${status.retrieved}`, "STATUS");
        }
        if (status.retrievedAt && !lastStatus.retrievedAt) {
          this.logger.log(`✓ RetrievedAt: ${status.retrievedAt}`, "STATUS");
          // Success! Piece has been retrieved
          return {
            success: true,
            finalStatus: status,
            checks: checkCount,
            durationMs: Date.now() - startTime,
          };
        }

        // Log periodic check (every 10 checks to reduce noise)
        if (checkCount % 10 === 0) {
          this.logger.log(
            `Check ${checkCount}: indexed=${status.indexed}, advertised=${status.advertised}, retrieved=${status.retrieved}`,
            "STATUS",
          );
        }

        lastStatus = status;
      } catch (error) {
        this.logger.log(`Error checking status: ${error.message}`, "STATUS");
        // Don't fail on individual check errors, keep trying
      }

      // Wait before next check
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    // Timeout reached
    const durationMs = Date.now() - startTime;
    this.logger.log(
      `Timeout after ${(durationMs / 1000).toFixed(1)}s, final status: ${JSON.stringify(lastStatus)}`,
      "STATUS",
    );
    throw new Error(
      `Timeout waiting for piece retrieval (${checkCount} checks over ${(durationMs / 1000).toFixed(1)}s)`,
    );
  }

  async monitorAndVerifyIPNI(
    pdpServer: PDPServer,
    pieceCid: string,
    blockCIDs: string[],
    expectedMultiaddr: string,
    statusTimeoutMs: number,
    ipniTimeoutMs: number,
    pollIntervalMs: number,
  ) {
    // First, wait for piece to be retrieved
    const monitoringResult = await this.monitorPieceStatus(pdpServer, pieceCid, statusTimeoutMs, pollIntervalMs);

    // Once retrieved, verify IPNI advertisement
    this.logger.log(`Piece retrieved, now verifying IPNI advertisement`);

    const ipniResult = await this.verifyIPNIAdvertisement(blockCIDs, expectedMultiaddr, ipniTimeoutMs);

    this.logger.log(
      `✓ IPNI verification complete: ${ipniResult.verified}/${ipniResult.total} CIDs verified in ${(
        ipniResult.durationMs / 1000
      ).toFixed(1)}s`,
    );

    return {
      monitoringResult,
      ipniResult,
    };
  }

  async verifyIPNIAdvertisement(blockCIDs: string[], expectedMultiaddr: string, maxDurationMs: number) {
    this.logger.log(`Verifying ${blockCIDs.length} CID(s) on IPNI`, "IPNI");
    this.logger.log(`Expected multiaddr: ${expectedMultiaddr}`, "IPNI");

    const startTime = Date.now();
    let successCount = 0;
    const failedCIDs: { cid: string; reason: string; addrs?: string[] }[] = [];

    for (let i = 0; i < blockCIDs.length; i++) {
      const cid = blockCIDs[i];
      const elapsed = Date.now() - startTime;

      if (elapsed > maxDurationMs) {
        throw new Error(
          `IPNI verification timeout after ${(elapsed / 1000).toFixed(1)}s (verified ${successCount}/${
            blockCIDs.length
          })`,
        );
      }

      try {
        this.logger.log(`Checking CID ${i + 1}/${blockCIDs.length}: ${cid.toString()}`, "IPNI");

        const addrs = await this.queryIPNI(cid, 5000);

        if (addrs.length === 0) {
          this.logger.log(`✗ CID not found on IPNI`, "IPNI");
          failedCIDs.push({ cid: cid.toString(), reason: "not found", addrs });
          continue;
        }

        // Check if our expected multiaddr is in the results
        if (!addrs.includes(expectedMultiaddr)) {
          this.logger.log(`✗ Expected multiaddr not found. Got: ${addrs.join(", ")}`, "IPNI");
          failedCIDs.push({ cid: cid.toString(), reason: "wrong multiaddr", addrs });
          continue;
        }

        this.logger.log(`✓ CID found with correct multiaddr`, "IPNI");
        successCount++;
      } catch (error) {
        this.logger.log(`✗ Error querying CID: ${error.message}`, "IPNI");
        failedCIDs.push({ cid: cid.toString(), reason: error.message });
      }
    }

    const durationMs = Date.now() - startTime;

    if (failedCIDs.length > 0) {
      throw new Error(
        `IPNI verification failed: ${successCount}/${blockCIDs.length} CIDs verified. ` +
          `Failed CIDs: ${JSON.stringify(failedCIDs, null, 2)}`,
      );
    }

    return {
      verified: successCount,
      total: blockCIDs.length,
      durationMs,
    };
  }

  httpsGet(hostname: string, path: string, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname,
        path,
        method: "GET",
        timeout: timeoutMs,
        headers: {
          "User-Agent": "filecoin-pin-health-check/1.0",
          Accept: "application/json",
        },
        autoSelectFamilyAttemptTimeout: 500,
      };

      const req = request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Failed to parse JSON response: ${error.message}`));
          }
        });
      });

      req.on("error", (error: Error) => {
        reject(new Error(`Request failed: ${error.message} (unknown)`));
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      });

      req.end();
    });
  }

  extractProviderAddrs(ipniResponse: any): string[] {
    const providerAddrs: string[] = [];
    for (const multihashResult of ipniResponse.MultihashResults || []) {
      for (const providerResult of multihashResult.ProviderResults || []) {
        if (providerResult.Provider?.Addrs) {
          providerAddrs.push(...providerResult.Provider.Addrs);
        }
      }
    }
    return providerAddrs;
  }

  async queryIPNI(cid: string, timeoutMs = 5000): Promise<string[]> {
    const response = await this.httpsGet("filecoinpin.contact", `/cid/${cid.toString()}`, timeoutMs);
    return this.extractProviderAddrs(response);
  }

  /**
   * Validate CAR conversion result
   */
  async validate(result: IpniPreprocessingResult): Promise<boolean> {
    const metadata = result.metadata;

    if (!metadata.enabled) {
      throw new Error("IPNI validation failed: enabled flag not set");
    }

    if (!metadata.rootCID) {
      throw new Error("IPNI validation failed: rootCID not generated");
    }

    if (!metadata.blockCIDs || metadata.blockCIDs.length === 0) {
      throw new Error("IPNI validation failed: no block CIDs generated");
    }

    if (metadata.blockCount !== metadata.blockCIDs.length) {
      throw new Error(
        `IPNI validation failed: block count mismatch (expected ${metadata.blockCount}, got ${metadata.blockCIDs.length})`,
      );
    }

    if (!result.data || result.size === 0) {
      throw new Error("IPNI validation failed: CAR data is empty");
    }

    this.logger.debug(`IPNI validation passed: ${metadata.blockCount} blocks, root CID: ${metadata.rootCID}`);

    return true;
  }

  /**
   * Convert data file to CAR format
   * Splits data into blocks and creates a CAR archive
   *
   * @param dataFile - Original data file to convert
   * @returns CAR file data with CIDs and metadata
   * @private
   */
  private async convertToCar(dataFile: { data: Buffer; size: number; name: string }): Promise<CarDataFile> {
    const numBlocks = Math.ceil(dataFile.size / MAX_BLOCK_SIZE);
    const blocks: { cid: CID; bytes: Uint8Array }[] = [];

    this.logger.debug(`Converting to CAR: ${numBlocks} blocks needed for ${dataFile.size} bytes`);

    // Create blocks from data
    for (let i = 0; i < numBlocks; i++) {
      const blockSize = i === numBlocks - 1 ? dataFile.size - i * MAX_BLOCK_SIZE : MAX_BLOCK_SIZE;

      const blockData = dataFile.data.slice(i * MAX_BLOCK_SIZE, (i + 1) * MAX_BLOCK_SIZE);
      const hash = await sha256.digest(blockData);
      const cid = CID.create(1, raw.code, hash);

      blocks.push({ cid, bytes: blockData });

      this.logger.debug(`  Block ${i + 1}/${numBlocks}: ${blockSize.toLocaleString()} bytes, CID: ${cid.toString()}`);
    }

    // Use first block as root CID
    const rootCID = blocks[0].cid;

    // Create CAR file with first block as root
    const { writer, out } = CarWriter.create([rootCID]);

    // Collect CAR output into a Uint8Array
    const chunks: Buffer[] = [];
    const carStream = Readable.from(out);

    carStream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    // Write all blocks to CAR
    const writePromise = (async () => {
      for (const block of blocks) {
        await writer.put(block);
      }
      await writer.close();
    })();

    // Wait for both writing and collecting to complete
    await writePromise;
    await new Promise<void>((resolve, reject) => {
      carStream.on("end", resolve);
      carStream.on("error", reject);
    });

    // Combine chunks into single Uint8Array
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const carData = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      carData.set(chunk, offset);
      offset += chunk.length;
    }

    const totalBlockSize = blocks.reduce((sum, b) => sum + b.bytes.length, 0);
    const blockCIDs = blocks.map((b) => b.cid);

    return {
      carData,
      rootCID,
      blockCIDs,
      blockCount: blocks.length,
      totalBlockSize,
      carSize: carData.length,
    };
  }
}
