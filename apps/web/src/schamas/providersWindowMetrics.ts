import { z } from "zod";

export const providerWindowMetricsSchema = z.object({
  providerId: z.string(),
  manuallyApproved: z.boolean(),
  storageSuccessRate: z.number(),
  storageSamples: z.number().int().nonnegative(),
  dataRetentionFaultRate: z.number(),
  dataRetentionSamples: z.number().int().nonnegative(),
  retrievalSuccessRate: z.number(),
  retrievalSamples: z.number().int().nonnegative(),
});

export type ProviderWindowMetrics = z.infer<typeof providerWindowMetricsSchema>;

export const providerWindowMetricsResponseSchema = z.object({
  data: z.array(providerWindowMetricsSchema),
  meta: z.object({
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    count: z.number().int().nonnegative(),
  }),
});

export type ProviderWindowMetricsResponse = z.infer<typeof providerWindowMetricsResponseSchema>;
