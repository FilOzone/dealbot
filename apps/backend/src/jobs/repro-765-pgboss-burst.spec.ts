// Repro test for FilOzone/dealbot#765 (claim B): a pg-boss worker slot that
// just finished a job longer than the poll interval refetches immediately
// (pg-boss dist/worker.js:65-71, sleeps only if interval - duration > 100 ms).
// Needs a local Postgres; run:
//   REPRO_765_PG=postgres://postgres@127.0.0.1:54329/postgres \
//     pnpm vitest run src/jobs/repro-765-pgboss-burst.spec.ts
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.REPRO_765_PG;
const POLL_S = 5;
const SLOW_MS = 8_000;

describe.skipIf(!url)("repro-765: pg-boss release-and-refetch burst", () => {
  let boss: PgBoss;

  beforeAll(async () => {
    boss = new PgBoss({ connectionString: url, schema: `repro765_${Date.now()}` });
    await boss.start();
  }, 60_000);

  afterAll(async () => {
    await boss.stop({ graceful: false });
  });

  async function run(label: string, concurrency: number, slowCount: number) {
    const queue = `q_${label}`;
    await boss.createQueue(queue, { policy: "singleton" });

    const slowEnd: number[] = [];
    const fastStart: Array<{ key: string; at: number }> = [];
    await boss.work<{ kind: string; key: string }>(
      queue,
      { batchSize: 1, localConcurrency: concurrency, pollingIntervalSeconds: POLL_S },
      async ([job]) => {
        if (job.data.kind === "slow") {
          await new Promise((r) => setTimeout(r, SLOW_MS));
          slowEnd.push(Date.now());
        } else {
          fastStart.push({ key: job.data.key, at: Date.now() });
        }
      },
    );

    for (let i = 0; i < slowCount; i++) {
      await boss.send(queue, { kind: "slow", key: `slow${i}` }, { singletonKey: `slow${i}` });
    }
    // Wait for all slow jobs to be picked up by a poll tick (<= POLL_S) before enqueueing fast ones.
    await new Promise((r) => setTimeout(r, (POLL_S + 1) * 1000));
    const t0 = Date.now();
    for (let i = 0; i < 6; i++) {
      await boss.send(queue, { kind: "fast", key: `fast${i}` }, { singletonKey: `fast${i}` });
    }
    // Wait for the slow jobs to finish plus one full poll interval of slack.
    await new Promise((r) => setTimeout(r, SLOW_MS + (POLL_S + 2) * 1000));

    const firstSlowEnd = Math.min(...slowEnd);
    const rows = fastStart
      .sort((a, b) => a.at - b.at)
      .map(
        (f) =>
          `  ${f.key}  +${f.at - t0} ms after enqueue  ${f.at - firstSlowEnd >= 0 ? "+" : ""}${f.at - firstSlowEnd} ms after first slow end`,
      );
    console.log(
      `\n[repro-765] ${label}: localConcurrency=${concurrency} slow=${slowCount} poll=${POLL_S}s slowDuration=${SLOW_MS}ms\n` +
        `  slow ends: ${slowEnd.map((t) => `+${t - t0} ms`).join(", ")}\n${rows.join("\n")}`,
    );
    expect(slowEnd).toHaveLength(slowCount);
    expect(fastStart).toHaveLength(6);
    return { t0, slowEnd, fastStart };
  }

  it("all slots busy (4 slow, concurrency 4): fast jobs start right after slow jobs return", async () => {
    const { slowEnd, fastStart } = await run("busy", 4, 4);
    const firstSlowEnd = Math.min(...slowEnd);
    const afterSlow = fastStart.map((f) => f.at - firstSlowEnd);
    // No fast job can start before a slot frees; the first ones must start well under the 5 s poll.
    expect(Math.min(...afterSlow)).toBeGreaterThanOrEqual(-50);
    expect(afterSlow.filter((d) => d < 500).length).toBeGreaterThanOrEqual(4);
  }, 60_000);

  it("as specified (2 slow, concurrency 4): idle slots also drain on their own poll tick", async () => {
    await run("spec", 4, 2);
  }, 60_000);
});
