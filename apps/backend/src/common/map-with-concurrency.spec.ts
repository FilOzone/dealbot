import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./map-with-concurrency.js";

describe("mapWithConcurrency", () => {
  it("runs every item", async () => {
    const seen: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item);
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;
    await mapWithConcurrency(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
      },
    );
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("propagates a rejection from any worker", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("waits for sibling workers after one fails", async () => {
    const completed: number[] = [];
    await expect(
      mapWithConcurrency([1, 2, 3, 4], 4, async (item) => {
        if (item === 2) throw new Error("boom");
        await new Promise((resolve) => setTimeout(resolve, item));
        completed.push(item);
      }),
    ).rejects.toThrow("boom");
    expect(completed.sort()).toEqual([1, 3, 4]);
  });

  it("does nothing for an empty list", async () => {
    await expect(mapWithConcurrency([], 5, async () => undefined)).resolves.toBeUndefined();
  });
});
