export const Queries = {
  GET_PROVIDERS_WITH_DATASETS: `
      query GetProvidersWithDataSet($addresses: [Bytes!]) {
        providers(where: {address_in: $addresses}) {
          address
          totalFaultedPeriods
          totalProvingPeriods
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
