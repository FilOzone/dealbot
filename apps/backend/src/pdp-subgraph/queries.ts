export const Queries = {
  GET_PROVIDERS_WITH_DATASETS: `
      query GetProvidersWithDataSet($addresses: [Bytes!], $blockNumber: BigInt!) {
        providers(where: {address_in: $addresses}) {
          address
          totalFaultedPeriods
          totalProvingPeriods
          proofSets (where: {nextDeadline_lt: $blockNumber}) {
            totalFaultedPeriods
            currentDeadlineCount
            nextDeadline
            maxProvingPeriod
          }
        }
      }
    `,
} as const;
