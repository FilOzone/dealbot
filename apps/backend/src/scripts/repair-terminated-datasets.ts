/**
 * One-shot backfill: scan open Deal rows where cleaned_up=false, group by
 * dataSetId, probe PDP liveness, and run the same repair sequence as the
 * data_set_creation `terminated` path for each PDP-dead dataset.
 *
 * Idempotent: dataSets already terminated will simply have no live deals to
 * mark; FWSS terminate may revert (caught) and the cleanup update filter
 * (cleaned_up=false) won't double-write.
 *
 * Usage (after `pnpm --filter dealbot-backend build`):
 *   node apps/backend/dist/scripts/repair-terminated-datasets.js [--dry-run]
 *
 * See FilOzone/dealbot#379.
 */
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DataSource } from "typeorm";
import { AppModule } from "../app.module.js";
import { toStructuredError } from "../common/logging.js";
import { Deal } from "../database/entities/deal.entity.js";
import { DealService } from "../deal/deal.service.js";

interface DataSetGroup {
  dataSetId: bigint;
  spAddress: string;
  dealIds: string[];
}

async function bootstrap(): Promise<void> {
  const logger = new Logger("RepairTerminatedDatasets");
  const dryRun = process.argv.includes("--dry-run");

  const app = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    bufferLogs: false,
  });
  app.enableShutdownHooks();

  try {
    const dealService = app.get(DealService);
    const dataSource = app.get(DataSource);

    const rows = await dataSource
      .getRepository(Deal)
      .createQueryBuilder("deal")
      .select("deal.id", "id")
      .addSelect("deal.dataSetId", "dataSetId")
      .addSelect("deal.spAddress", "spAddress")
      .where("deal.cleanedUp = :cleanedUp", { cleanedUp: false })
      .andWhere("deal.dataSetId IS NOT NULL")
      .getRawMany<{ id: string; dataSetId: string; spAddress: string }>();

    const groups = new Map<string, DataSetGroup>();
    for (const row of rows) {
      const key = `${row.spAddress}:${row.dataSetId}`;
      let group = groups.get(key);
      if (!group) {
        group = { dataSetId: BigInt(row.dataSetId), spAddress: row.spAddress, dealIds: [] };
        groups.set(key, group);
      }
      group.dealIds.push(row.id);
    }

    logger.log({
      event: "backfill_started",
      message: "Scanning datasets for PDP-terminated state",
      dryRun,
      datasets: groups.size,
      deals: rows.length,
    });

    let terminatedCount = 0;
    let liveCount = 0;
    let totalRepaired = 0;
    const failures: Array<{ dataSetId: string; spAddress: string; error: string }> = [];

    for (const group of groups.values()) {
      try {
        const live = await dealService.isDataSetLive(group.dataSetId);
        if (live) {
          liveCount++;
          continue;
        }
        terminatedCount++;
        logger.warn({
          event: "backfill_terminated_detected",
          dataSetId: group.dataSetId.toString(),
          spAddress: group.spAddress,
          dealCount: group.dealIds.length,
          dryRun,
        });
        if (dryRun) continue;
        const result = await dealService.repairTerminatedDataSet(group.spAddress, group.dataSetId);
        totalRepaired += result.dealsAffected;
      } catch (error) {
        failures.push({
          dataSetId: group.dataSetId.toString(),
          spAddress: group.spAddress,
          error: error instanceof Error ? error.message : String(error),
        });
        logger.error({
          event: "backfill_repair_failed",
          dataSetId: group.dataSetId.toString(),
          spAddress: group.spAddress,
          error: toStructuredError(error),
        });
      }
    }

    logger.log({
      event: "backfill_completed",
      message: "Backfill repair summary",
      dryRun,
      datasetsScanned: groups.size,
      live: liveCount,
      terminated: terminatedCount,
      dealsCleanedUp: totalRepaired,
      failures: failures.length,
    });

    if (failures.length > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    logger.error({
      event: "backfill_fatal",
      error: toStructuredError(error),
    });
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

bootstrap();
