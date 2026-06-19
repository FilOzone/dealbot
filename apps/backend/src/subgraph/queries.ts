export const Queries = {
  GET_PROVIDERS_WITH_DATASETS: `
      query GetProvidersWithDataSet($addresses: [Bytes!], $blockNumber: BigInt!) {
        providers(where: {address_in: $addresses}) {
          address
          totalFaultedPeriods
          totalProvingPeriods
          proofSets (where: {nextDeadline_lt: $blockNumber, status: PROVING}) {
            nextDeadline
            maxProvingPeriod
          }
        }
      }
    `,
  GET_SUBGRAPH_META: `
    query GetSubgraphMeta {
      _meta {
        block {
          number
        }
      }
    }
  `,
} as const;

/**
 * Build a samplePiece query scoped to the requested pool. The query
 * shape varies in two ways: whether the proofSet filter pins
 * `withIPFSIndexing: true`, and whether sampleKey is searched forward
 * (`_gte` + asc — smallest key at or above the target) or backward
 * (`_lt` + desc — largest key below the target). Filter direction and
 * sort direction move together so both modes return the piece closest
 * to the target sampleKey.
 */
export function buildSamplePieceQuery(pool: "indexed" | "any", reverse: boolean = false): string {
  const indexingFilter = pool === "indexed" ? "withIPFSIndexing: true" : "";
  const sampleKeyFilter = reverse ? "sampleKey_lt" : "sampleKey_gte";
  const orderDirection = reverse ? "desc" : "asc";
  return `
    query SamplePiece(
      $serviceProvider: Bytes!
      $payer: Bytes!
      $sampleKey: Bytes!
      $minSize: BigInt!
      $maxSize: BigInt!
    ) {
      _meta {
        block {
          number
        }
      }
      roots(
        first: 1
        orderBy: sampleKey
        orderDirection: ${orderDirection}
        where: {
          ${sampleKeyFilter}: $sampleKey
          removed: false
          rawSize_gte: $minSize
          rawSize_lte: $maxSize
          proofSet_: {
            fwssServiceProvider: $serviceProvider
            fwssPayer_not: $payer
            isActive: true
            ${indexingFilter}
          }
        }
        subgraphError: allow
      ) {
        rootId
        cid
        rawSize
        ipfsRootCID
        proofSet {
          setId
          withIPFSIndexing
          fwssPayer
          pdpPaymentEndEpoch
        }
      }
    }
  `;
}
