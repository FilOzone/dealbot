import { CLICKHOUSE_NETWORK_TABLES } from "./clickhouse.schema.js";

// Migrations are immutable after release. Add a higher version for every later
// schema change so deployed databases can advance without replaying old work.
export interface ClickHouseMigration {
  version: number;
  name: string;
  up: string[];
}

const NETWORK_KEY = "(network, probe_location, sp_address, timestamp)";
const NETWORK_PARTITION = "(network, toStartOfMonth(timestamp))";

function rebuildTableWithNetworkKeys(database: string, table: string, version: number): string[] {
  const replacementTable = `__dealbot_migration_${version}_${table}`;
  const source = `${database}.${table}`;
  const replacement = `${database}.${replacementTable}`;

  // A retry discards only its previous replacement table. EXCHANGE makes the
  // cutover atomic; after it succeeds, the replacement name holds the old table.
  return [
    `DROP TABLE IF EXISTS ${replacement} SYNC`,
    `CREATE TABLE ${replacement}
AS ${source}
ENGINE = MergeTree()
PARTITION BY ${NETWORK_PARTITION}
ORDER BY ${NETWORK_KEY}
PRIMARY KEY ${NETWORK_KEY}
TTL toDateTime(timestamp) + INTERVAL 1 YEAR`,
    `INSERT INTO ${replacement} SELECT * FROM ${source}`,
    `EXCHANGE TABLES ${source} AND ${replacement}`,
    `DROP TABLE ${replacement} SYNC`,
  ];
}

export function getClickHouseMigrations(database: string): ClickHouseMigration[] {
  const version = 1;

  return [
    {
      version,
      name: "add_network_to_table_keys",
      up: CLICKHOUSE_NETWORK_TABLES.flatMap((table) => rebuildTableWithNetworkKeys(database, table, version)),
    },
  ];
}
