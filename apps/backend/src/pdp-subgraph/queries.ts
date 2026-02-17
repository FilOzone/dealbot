export const Queries = {
  GET_PROVIDERS_WITH_DATASETS: `
      query GetProvidersWithDataSet($blockNumber: BigInt!) {
        providers {
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
