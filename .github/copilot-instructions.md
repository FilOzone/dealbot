# Pull Request Review Instructions

## Goal

Review for material correctness, security, state-consistency, compatibility, or maintainability regressions. Optimize for high-signal feedback. Prefer silence over speculation.

## Review Philosophy

- Comment only when confident a real issue exists in the changed code or its immediate context.
- Prioritize issues as `Blocker` or `Important`.
- Prefer incremental improvement over idealized rewrites. Do not request broad refactors unless needed to prevent a defect.
- Focus on issues the author can reasonably address in this PR.
- If the PR is too large to review confidently, leave at most one comment asking for a smaller PR.
- If uncertain, do not comment.

## Dealbot Context

- TypeScript monorepo: NestJS backend (`apps/backend`), React/Vite frontend (`apps/web`), subgraph (`apps/subgraph`).
- Sources of truth: Postgres (operational state) and Prometheus (metrics). Discourage adding new persisted DB state; prefer events/metrics or reusing existing columns. Flag PRs that store data the system does not need.
- ClickHouse: the DDL (`apps/backend/src/clickhouse/clickhouse.schema.ts`) and event payloads are owned in-repo and in-scope for review (schema, column types, payload shape, producer correctness). Cluster ops, retention, and infra tuning are owned by an external team — do not propose changes there.
- A "check" is a task type (data storage, retrieval, data retention). A "job" is one execution of a check against one SP.

## Core Invariants

- At most one job per SP per check type per network runs at a time. Flag changes that could allow concurrent or duplicate jobs for the same SP on the same network.
- A job is marked failed only when job execution itself fails. A check that completes and reports a negative outcome is a successful job with a failing check result. Do not treat a negative check result as a job failure.
- Scheduling, cleanup, active-provider filtering, and queue execution must agree on the same set of SPs and the same network.
- For network-aware code, inserts, queries, conflict keys, filters, and tests must all carry the same network invariants.

## Priorities

### Blocker

- Security vulnerabilities, secrets exposure, broken auth/authz, unsafe input handling, or logs that could leak tokens, credentials, or private data.
- Correctness defects that break job lifecycle invariants, provider filtering, multi-network behavior, retries, queue execution, or state transitions.
- Breaking schema, migration, query, config, or storage changes without compatibility, rollout, or migration safety.
- Missing validation, permission checks, or failure handling where users, data, or production stability could be harmed.

### Important

- Tests, mocks, or fixtures that no longer match the real runtime or API contract.
- SQL issues involving quoted identifiers, nullability, conflict keys, cross-network collisions, or behavior differences between databases.
- Error handling or observability gaps that would make failures hard to diagnose, mitigate, or roll back.

## Repository-Specific Focus

- When changing provider filtering or blocklists, look for stale schedules, skipped cleanup, duplicate work, or drift between selection and execution paths.
- For frontend changes, prioritize user-visible correctness and contract drift over low-impact optimizations.

## Do Not Comment On

- Formatting, lint, import order, generated files, lockfiles, or issues already enforced by CI, formatters, or static analysis (unless the issue reflects a real runtime bug or missing invariant).
- Pure preference between multiple reasonable approaches.
- Minor naming tweaks, comment additions, or speculative future refactors unless they hide a real defect or maintenance risk.

## Comment Format

Use one issue per comment:

- `Blocker: short title` or `Important: short title`
- what is wrong and where it appears
- why it matters
- minimal fix or concrete next step
