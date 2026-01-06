import type { Logger } from "@nestjs/common";
import type { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";

export function scheduleJobWithOffset(
  name: string,
  offsetSeconds: number,
  intervalSeconds: number,
  schedulerRegistry: SchedulerRegistry,
  callback: () => Promise<void>,
  logger?: Logger,
) {
  const offsetMs = offsetSeconds * 1000;

  setTimeout(() => {
    const cronExpression = secondsToCronExpression(intervalSeconds);
    const job = new CronJob(cronExpression, () => {
      callback();
    });

    schedulerRegistry.addCronJob(name, job);
    job.start();

    if (logger) {
      logger.log(`${name} started with ${offsetSeconds}s offset, running every ${intervalSeconds}s`);
    }
  }, offsetMs);
}

export function secondsToCronExpression(seconds: number): string {
  if (seconds < 60) {
    return `*/${seconds} * * * * *`;
  } else if (seconds === 60) {
    return "0 * * * * *";
  } else if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `0 */${minutes} * * * *`;
  } else {
    return `*/${seconds} * * * * *`;
  }
}

/**
 * Creates a promise that rejects after the specified timeout
 * @param timeoutMs - Timeout in milliseconds
 * @param message - Optional error message
 * @returns A promise that rejects with a timeout error
 */
export function createTimeoutPromise(timeoutMs: number, message?: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(message || `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

/**
 * Wraps a promise with a timeout
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param errorMessage - Optional custom error message
 * @returns A promise that rejects if the timeout is reached before the original promise resolves
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage?: string): Promise<T> {
  return Promise.race([promise, createTimeoutPromise(timeoutMs, errorMessage)]);
}
