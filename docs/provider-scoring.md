# FOC Provider Scoring

This document describes a default strategy for how storage providers (SPs) can be ranked. No code in this repo currently uses this methodology; it is intended as a guide for dashboards that want to give a sort order for SPs (e.g., https://probelab.io/filecoin/foc/).

## Overview

Providers are sorted by three criteria evaluated left-to-right. The first criterion that differs between two providers determines their relative position while later criteria only matter when earlier ones are tied.

| Priority | Criterion | Direction | What it means |
|---|---|---|---|
| 1 | Approved (yes/no) | Approved first | Providers marked as approved in the on-chain SP Registry appear above those that are not |
| 2 | Bayesian score (0–100) | Higher first | Confidence-adjusted weighted quality signal; missing check data lowers it (see below) |
| 3 | Provider ID | Lower first | Deterministic tiebreaker when everything else is equal |

Approval itself is an on-chain decision. The dealbot check data — and the [approval criteria](checks/production-configuration-and-approval-methodology.md) built on it — guides that decision rather than setting it directly; dealbot does not flip the approved flag. The scenarios below note the check signals that would typically inform whether a provider is approved.

## Bayesian Score

### Why raw percentages aren't enough

A raw success rate treats 97 % from 200 checks identically to 97 % from 2 000 checks. A newly onboarded provider that happened to have a perfect first two weeks looks identical to an established one with years of data. This conflates certainty with quality.

The Bayesian score instead asks: *given what has actually been observed, what success rate can we be 95 % confident the provider truly sustains?* The answer is always lower than the observed rate but increasingly less so as the sample count grows.

### How the score is calculated

For each check type, the score is the **95 % Bayesian credible lower bound** on the provider's true success rate. The statistical model assumes no prior knowledge of the provider (a uniform prior), then updates based on the observed successes and failures:

```
lower bound = 5th percentile of Beta(1 + successes, 1 + failures) × 100
```

In plain terms: given the observed data, there is a 95 % probability that the provider's true long-run success rate is at least this high. The bound is conservative by design. It represents a floor we can be confident in and not the most likely value.

### Example Calculations

| Observed rate | Sample count | Bayesian lower bound |
|---|---|---|
| 97.0 % | 200 | ~94.2 % |
| 97.0 % | 2 000 | ~96.3 % |
| 99.0 % | 200 | ~96.9 % |
| 99.0 % | 2 000 | ~98.6 % |
| 100.0 % | 200 | ~98.5 % |
| 100.0 % | 2 000 | ~99.9 % |

Notice that the 97 % provider with 2 000 checks (lower bound ~96.3 %) and the 99 % provider with 200 checks (lower bound ~96.9 %) score nearly identically — the scoring correctly recognizes them as about equally trustworthy despite the different observed rates.

### Check weights

The three active check types are combined as a weighted average of their individual lower bounds:

| Check | Weight | Rationale |
|---|---|---|
| Data retention | 40 % | Data loss is the worst outcome for a storage service; ongoing proof-of-custody is hard to fake and has no client-side recovery path |
| Data retrieval | 35 % | Inability to serve stored data when a client needs it is an immediately user-visible failure with no retry on the client side |
| Data storage | 25 % | Upload failures are retryable; important as the end-to-end ingest signal but lower stakes than the read path |

When a check type has no data at all (zero samples), its lower bound is treated as zero and it still contributes its full weight to the average. A provider missing data on a check therefore scores lower than an otherwise-equal provider with full coverage. This keeps the ranking simple as a single score handles both quality and data completeness.

### Checks not yet in the score

These additional check types already run in dealbot and could be incorporated into the score:

* [Pull](checks/pull-check.md)
* [Sampled Retrieval](checks/sampled-retrievals.md)

They aren't included currently because they aren't part of the [SP approval criteria](checks/production-configuration-and-approval-methodology.md).

## Missing Check Data

Because a missing check contributes zero to the Bayesian score (see [Check weights](#check-weights)), data gaps are handled by the score itself rather than a separate sort criterion. A provider that genuinely has no data on a check, for example, a newly onboarded provider that has not yet accumulated enough retention periods, scores lower than peers with full coverage.

When dealbot itself encounters a probing outage, the gap typically affects all providers simultaneously. Every provider loses the same check contribution, so relative ordering within each group is unchanged even though absolute scores drop.

## Concrete Scenarios

### 1. Established approved provider

- Retention: 0 faults / 3 000 periods → lower bound ~99.8 %
- Retrieval: 2 910 / 3 000 checks → lower bound ~96.2 %
- Storage: 2 910 / 3 000 checks → lower bound ~96.2 %
- **Bayesian score**: 0.40 × 99.8 + 0.35 × 96.2 + 0.25 × 96.2 ≈ **97.9**
- Sort position: approved · score 97.9

### 2. New provider, good rates, low sample count

- Retention: 0 faults / 520 periods → lower bound ~98.5 %
- Retrieval: 194 / 200 checks → lower bound ~92.8 %
- Storage: 194 / 200 checks → lower bound ~92.8 %
- **Bayesian score**: 0.40 × 98.5 + 0.35 × 92.8 + 0.25 × 92.8 ≈ **95.6**
- Sort position: approved · score 95.6 — approved, but ranked below the established provider despite the same observed retrieval rate, because the lower sample count means we are less certain

### 3. Borderline provider, exactly at the approval thresholds

- Retention: 1 fault / 500 periods → lower bound ~97.9 % on the non-fault side
- Retrieval: 194 / 200 checks (97 %) → lower bound ~92.8 %
- Storage: 194 / 200 checks (97 %) → lower bound ~92.8 %
- **Bayesian score**: 0.40 × 97.9 + 0.35 × 92.8 + 0.25 × 92.8 ≈ **94.9**
- Sort position: approved · score 94.9 — approved but ranks last among approved providers

### 4. Dealbot probing outage (storage checks unavailable for all providers)

When dealbot cannot reach any provider for storage checks:

- The storage check contributes zero for every provider (its 25 % weight is applied to a zero lower bound), so every score drops by up to 25 points
- Because the gap affects all providers equally, no one gains or loses ground relative to peers
- The Bayesian score still reflects retention and retrieval performance
- Relative ordering within each group remains unchanged

### 5. Poor retrieval performance, strong retention

A provider has reliable storage and retention but struggles to serve data back to clients.

- Retention: 0 faults / 2 000 periods → lower bound ~99.7 %
- Retrieval: 1 600 / 2 000 checks (80 %) → lower bound ~78.3 %
- Storage: 1 960 / 2 000 checks (98 %) → lower bound ~97.1 %
- **Bayesian score**: 0.40 × 99.7 + 0.35 × 78.3 + 0.25 × 97.1 ≈ **91.2**
- Sort position: not approved (retrieval below threshold) · score 91.2 — the 35 % retrieval weight pulls the score down substantially despite the near-perfect retention

### 6. High fault rate, ample samples

A provider has accumulated many retention periods but consistently loses data.

- Retention: 30 faults / 1 000 periods (3 % fault rate) → lower bound on non-fault side ~95.6 %
- Retrieval: 940 / 1 000 checks (94 %) → lower bound ~92.3 %
- Storage: 960 / 1 000 checks (96 %) → lower bound ~94.6 %
- **Bayesian score**: 0.40 × 95.6 + 0.35 × 92.3 + 0.25 × 94.6 ≈ **94.2**
- Sort position: not approved (fault rate well above the 0.2 % approval threshold) · score 94.2 — a respectable-looking Bayesian score, but the fault rate is far outside the range that would guide an on-chain approval; the score reflects the ample sample count narrowing the interval around a genuinely poor observed rate
