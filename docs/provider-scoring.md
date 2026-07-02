# FOC Provider Scoring

This document describes a default strategy for how storage providers (SPs) can be ranked. No code in this repo currently uses this methodology; it is intended as a guide for dashboards that want to give a sort order for SPs (e.g., https://probelab.io/filecoin/foc/).

## Overview

Providers are sorted by four criteria evaluated left-to-right. The first criterion that differs between two providers determines their relative position while later criteria only matter when earlier ones are tied.

| Priority | Criterion | Direction | What it means |
|---|---|---|---|
| 1 | Approved (yes/no) | Approved first | Providers marked as approved in the on-chain SP Registry appear above those that are not |
| 2 | Complete data (yes/no) | Complete first | Within each approval group, providers with data on every check rank above those with coverage gaps |
| 3 | Bayesian score (0–100) | Higher first | Confidence-adjusted weighted quality signal |
| 4 | Provider ID | Lower first | Deterministic tiebreaker when everything else is equal |

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

Notice that the 97 % provider with 2 000 checks (lower bound ~96.3 %) and the 99 % provider with 200 checks (lower bound ~96.9 %) score nearly identically — the scoring correctly recognises them as about equally trustworthy despite the different observed rates.

### Check weights

The three active check types are combined as a weighted average of their individual lower bounds:

| Check | Weight | Rationale |
|---|---|---|
| Data retention | 40 % | Data loss is the worst outcome for a storage service; ongoing proof-of-custody is hard to fake and has no client-side recovery path |
| Data retrieval | 35 % | Inability to serve stored data when a client needs it is an immediately user-visible failure with no retry on the client side |
| Data storage | 25 % | Upload failures are retryable; important as the end-to-end ingest signal but lower stakes than the read path |

When a check type has no data at all (zero samples), its weight is redistributed proportionally to the remaining checks so the score stays meaningful and within the 0–100 range.

### Planned future checks

Three additional check types are planned for dealbot and will be incorporated into the score when they launch:

| Check | Planned weight | Purpose                                                                       |
|---|----------------|-------------------------------------------------------------------------------|
| Sampled retrieval | TBD            | Retrieves real FWSS pieces held by the provider; not synthetic dealbot corpus |
| Pull pathway | TBD           | Tests the SP pull workflow                                                    |

## Data Gap Criterion

The second sort criterion groups providers that are missing data on any active check below those with full coverage, within the same approval tier.

Important context when dealbot has probing issues: when dealbot itself encounters a probing outage, the gap typically affects all providers simultaneously. This means no single provider is penalized relative to its peers. The approval status and Bayesian score already reflect the reduced data, and the coverage gap marker fires equally for everyone, leaving relative ordering unchanged.

This criterion primarily matters when one provider genuinely has no data on a check while others do; For example, a newly onboarded provider that has not yet accumulated enough retention periods.

One structural note: a provider with a data gap on any check cannot be approved (no samples means the sample-count criterion fails, which blocks approval). So the state "approved and has a data gap" cannot occur. The data gap criterion only differentiates providers within the non-approved group.

## Concrete Scenarios

### 1. Established approved provider

- Retention: 0 faults / 3 000 periods → lower bound ~99.8 %
- Retrieval: 2 910 / 3 000 checks → lower bound ~96.2 %
- Storage: 2 910 / 3 000 checks → lower bound ~96.2 %
- **Bayesian score**: 0.40 × 99.8 + 0.35 × 96.2 + 0.25 × 96.2 ≈ **97.9**
- Sort position: approved · complete data · score 97.9

### 2. New provider, good rates, low sample count

- Retention: 0 faults / 520 periods → lower bound ~98.5 %
- Retrieval: 194 / 200 checks → lower bound ~92.8 %
- Storage: 194 / 200 checks → lower bound ~92.8 %
- **Bayesian score**: 0.40 × 98.5 + 0.35 × 92.8 + 0.25 × 92.8 ≈ **95.6**
- Sort position: approved · complete data · score 95.6 — approved, but ranked below the established provider despite the same observed retrieval rate, because the lower sample count means we are less certain

### 3. Borderline provider, exactly at the approval thresholds

- Retention: 1 fault / 500 periods → lower bound ~97.9 % on the non-fault side
- Retrieval: 194 / 200 checks (97 %) → lower bound ~92.8 %
- Storage: 194 / 200 checks (97 %) → lower bound ~92.8 %
- **Bayesian score**: 0.40 × 97.9 + 0.35 × 92.8 + 0.25 × 92.8 ≈ **94.9**
- Sort position: approved · complete data · score 94.9 — approved but ranks last among approved providers

### 4. Dealbot probing outage (storage checks unavailable for all providers)

When dealbot cannot reach any provider for storage checks:

- Storage weight (25 %) redistributes to retention and retrieval for every provider
- The coverage gap criterion fires equally for all providers — no one gains or loses ground relative to peers
- The Bayesian score still reflects retention and retrieval performance
- Relative ordering within each group remains unchanged

### 5. Poor retrieval performance, strong retention

A provider has reliable storage and retention but struggles to serve data back to clients.

- Retention: 0 faults / 2 000 periods → lower bound ~99.7 %
- Retrieval: 1 600 / 2 000 checks (80 %) → lower bound ~78.3 %
- Storage: 1 960 / 2 000 checks (98 %) → lower bound ~97.1 %
- **Bayesian score**: 0.40 × 99.7 + 0.35 × 78.3 + 0.25 × 97.1 ≈ **91.2**
- Sort position: not approved (retrieval below threshold) · complete data · score 91.2 — the 35 % retrieval weight pulls the score down substantially despite the near-perfect retention

### 6. High fault rate, ample samples

A provider has accumulated many retention periods but consistently loses data.

- Retention: 30 faults / 1 000 periods (3 % fault rate) → lower bound on non-fault side ~95.6 %
- Retrieval: 940 / 1 000 checks (94 %) → lower bound ~92.3 %
- Storage: 960 / 1 000 checks (96 %) → lower bound ~94.6 %
- **Bayesian score**: 0.40 × 95.6 + 0.35 × 92.3 + 0.25 × 94.6 ≈ **94.2**
- Sort position: not approved (fault rate well above 0.2 % threshold) · complete data · score 94.2 — a respectable-looking Bayesian score but blocked from approval by the hard retention fault gate; the score reflects the ample sample count narrowing the interval around a genuinely poor observed rate
