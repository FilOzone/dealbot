type LoggerLike = {
  log: (message: string, ...meta: unknown[]) => void;
  warn: (message: string, ...meta: unknown[]) => void;
  error: (message: string, ...meta: unknown[]) => void;
};

type ScheduleConfig = {
  jobName: string;
  intervalSeconds: number;
  startOffsetSeconds: number;
  getLastRunAt: () => Promise<Date | null>;
  run: () => Promise<void>;
};

type ScheduleRunConfig = {
  jobName: string;
  intervalSeconds: number;
  getLastRunAt: () => Promise<Date | null>;
  run: () => Promise<void>;
  runAt: Date;
  reason: string;
};

type ExecuteConfig = {
  jobName: string;
  intervalSeconds: number;
  getLastRunAt: () => Promise<Date | null>;
  run: () => Promise<void>;
};

export class DbAnchoredScheduler {
  constructor(private readonly logger: LoggerLike) {}

  /**
   * Schedule the first run using the last DB timestamp if available,
   * otherwise apply the startup offset for a fresh DB.
   */
  async scheduleInitialRun({
    jobName,
    intervalSeconds,
    startOffsetSeconds,
    getLastRunAt,
    run,
  }: ScheduleConfig): Promise<void> {
    let nextRunAt: Date;
    const initialDelaySeconds = Math.max(0, startOffsetSeconds);

    try {
      const lastRunAt = await getLastRunAt();
      if (lastRunAt) {
        nextRunAt = new Date(lastRunAt.getTime() + intervalSeconds * 1000);
      } else {
        nextRunAt = new Date(Date.now() + initialDelaySeconds * 1000);
      }
    } catch (error) {
      this.logger.warn(`[${jobName}] Failed to load last run time, using startup offset`, error);
      nextRunAt = new Date(Date.now() + initialDelaySeconds * 1000);
    }

    this.scheduleRunAt({
      jobName,
      intervalSeconds,
      getLastRunAt,
      run,
      runAt: nextRunAt,
      reason: "initial",
    });
  }

  /**
   * Schedule a one-shot timer for the next run and re-arm after completion.
   */
  private scheduleRunAt({ jobName, intervalSeconds, getLastRunAt, run, runAt, reason }: ScheduleRunConfig): void {
    const delayMs = Math.max(0, runAt.getTime() - Date.now());
    const delaySeconds = Math.round(delayMs / 1000);
    this.logger.log(`[${jobName}] Next run scheduled (${reason}) in ${delaySeconds}s at ${runAt.toISOString()}`);

    setTimeout(() => {
      void this.executeScheduledJob({
        jobName,
        intervalSeconds,
        getLastRunAt,
        run,
      });
    }, delayMs);
  }

  /**
   * Execute a scheduled job and compute the next run time from DB state.
   */
  private async executeScheduledJob({ jobName, intervalSeconds, getLastRunAt, run }: ExecuteConfig): Promise<void> {
    const runStartedAt = new Date();
    try {
      await run();
    } catch (error) {
      this.logger.error(`[${jobName}] Scheduled run failed`, error);
    }

    const runFinishedAt = new Date();
    let nextRunAt: Date;

    try {
      const lastRunAt = await getLastRunAt();
      if (lastRunAt && lastRunAt.getTime() >= runStartedAt.getTime()) {
        nextRunAt = new Date(lastRunAt.getTime() + intervalSeconds * 1000);
      } else {
        nextRunAt = new Date(runFinishedAt.getTime() + intervalSeconds * 1000);
      }
    } catch (error) {
      this.logger.warn(`[${jobName}] Failed to load last run time, using run completion`, error);
      nextRunAt = new Date(runFinishedAt.getTime() + intervalSeconds * 1000);
    }

    this.scheduleRunAt({
      jobName,
      intervalSeconds,
      getLastRunAt,
      run,
      runAt: nextRunAt,
      reason: "post-run",
    });
  }
}
