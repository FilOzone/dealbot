#!/usr/bin/env node
/**
 * Post-build validation checks that run against the compiled dist/ output.
 *
 * These catch runtime errors that unit tests miss because vitest (SWC) does
 * not emit the same decorator metadata as tsc.  Add new check functions to
 * the `checks` array below.
 *
 * Usage:  node scripts/postbuild-checks.mjs
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_ENTITIES_DIR = join(__dirname, "..", "dist", "database", "entities");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadEntities() {
  if (!existsSync(DIST_ENTITIES_DIR)) {
    throw new Error(`Entity directory not found: ${DIST_ENTITIES_DIR}`);
  }

  const files = readdirSync(DIST_ENTITIES_DIR)
    .filter((f) => f.endsWith(".entity.js"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No *.entity.js files found in ${DIST_ENTITIES_DIR}`);
  }

  // Import all entity modules so their @Entity() decorators register with
  // TypeORM's global metadata storage.
  for (const file of files) {
    await import(pathToFileURL(join(DIST_ENTITIES_DIR, file)).href);
  }

  // Only return classes that TypeORM actually registered as entities, not
  // arbitrary exported helper functions.
  const { getMetadataArgsStorage } = await import("typeorm");
  const registeredTargets = new Set(getMetadataArgsStorage().tables.map((t) => t.target));

  const entities = [...registeredTargets];
  if (entities.length === 0) {
    throw new Error(`Loaded ${files.length} file(s) from ${DIST_ENTITIES_DIR} but none registered TypeORM entities`);
  }

  console.log(`  ℹ ${entities.length} entity class(es) from ${files.length} file(s) in dist/database/entities`);
  return entities;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * Validates that every entity's column types are supported by the target
 * database driver.  This catches e.g. using a bare `bigint` TS type on a
 * @Column() without an explicit `type`, which makes TypeORM emit a
 * DataTypeNotSupportedError at startup.
 */
async function checkEntityMetadata() {
  const { DataSource } = await import("typeorm");
  const entities = await loadEntities();

  const ds = new DataSource({
    type: "postgres",
    host: "localhost",
    database: "unused",
    entities,
    synchronize: false,
  });

  // buildMetadatas() validates column types against the driver without
  // requiring a live database connection.
  await ds.buildMetadatas();
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** @type {Array<{ name: string; fn: () => Promise<void> }>} */
const checks = [{ name: "entity-metadata", fn: checkEntityMetadata }];

let failed = 0;
for (const check of checks) {
  try {
    await check.fn();
    console.log(`  ✓ ${check.name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${check.name}: ${err.message}`);
  }
}

if (failed) {
  console.error(`\n${failed}/${checks.length} postbuild check(s) failed.`);
  process.exit(1);
} else {
  console.log(`\n${checks.length}/${checks.length} postbuild check(s) passed.`);
}
