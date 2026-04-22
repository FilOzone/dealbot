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
  SAMPLE_ANON_PIECE_INDEXED: `
    query SampleAnonPieceIndexed(
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
            withIPFSIndexing: true
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
  `,
  SAMPLE_ANON_PIECE_ANY: `
    query SampleAnonPieceAny(
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
  `,
} as const;
