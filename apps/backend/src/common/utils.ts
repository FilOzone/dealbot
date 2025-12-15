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
