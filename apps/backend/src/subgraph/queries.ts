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
 * Build a sampleAnonPiece query scoped to the requested pool. The single
 * piece of query shape that differs is whether the proofSet filter pins
 * `withIPFSIndexing: true`; assembling the fragment here keeps the rest
 * of the query and the returned selection set shared.
 */
export function buildSampleAnonPieceQuery(pool: "indexed" | "any"): string {
  const indexingFilter = pool === "indexed" ? "withIPFSIndexing: true" : "";
  return `
    query SampleAnonPiece(
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
        orderDirection: asc
        where: {
          sampleKey_gte: $sampleKey
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
