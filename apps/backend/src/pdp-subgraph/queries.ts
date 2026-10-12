export const Queries = {
  GET_PROVIDERS_WITH_DATASETS: `
      query GetProvidersWithDataSet($addresses: [Bytes!], $blockNumber: BigInt!) {
        providers(where: {address_in: $addresses}, subgraphError: allow) {
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
          timestamp
        }
        hasIndexingErrors
      }
    }
  `,
} as const;
