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
  GET_FWSS_CANDIDATE_PIECES: `
    query GetFwssCandidatePieces(
      $serviceProvider: Bytes!
      $payer: Bytes!
      $datasetLimit: Int!
      $pieceLimit: Int!
    ) {
      _meta {
        block {
          number
        }
      }
      dataSets(
        where: {
          fwssServiceProvider: $serviceProvider
          fwssPayer_not: $payer
          isActive: true
        }
        first: $datasetLimit
        orderBy: createdAt
        orderDirection: desc
        subgraphError: allow
      ) {
        setId
        withIPFSIndexing
        pdpPaymentEndEpoch
        roots(
          where: { removed: false }
          first: $pieceLimit
          orderBy: createdAt
          orderDirection: desc
        ) {
          rootId
          cid
          rawSize
          ipfsRootCID
        }
      }
    }
  `,
} as const;
