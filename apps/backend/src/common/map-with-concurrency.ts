/** Runs `fn` with bounded concurrency and waits for sibling workers before rethrowing an error. */
export async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  let failed = false;
  let firstError: unknown;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const item = items[index++];
      try {
        await fn(item);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failed) throw firstError;
}
