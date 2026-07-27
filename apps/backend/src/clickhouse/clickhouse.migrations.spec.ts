import { describe, expect, it } from "vitest";
import { getClickHouseMigrations } from "./clickhouse.migrations.js";
import { CLICKHOUSE_NETWORK_TABLES } from "./clickhouse.schema.js";

describe("getClickHouseMigrations", () => {
  it("rebuilds every check table with network-aware partition and primary keys", () => {
    const migrations = getClickHouseMigrations("dealbot");

    expect(migrations).toHaveLength(1);
    expect(migrations[0]).toMatchObject({
      version: 1,
      name: "add_network_to_table_keys",
    });

    const statements = migrations[0].up;
    expect(statements).toHaveLength(CLICKHOUSE_NETWORK_TABLES.length * 5);

    for (const table of CLICKHOUSE_NETWORK_TABLES) {
      const replacement = `dealbot.__dealbot_migration_1_${table}`;
      const source = `dealbot.${table}`;

      expect(statements).toContain(`DROP TABLE IF EXISTS ${replacement} SYNC`);
      expect(statements).toContain(
        `CREATE TABLE ${replacement}
AS ${source}
ENGINE = MergeTree()
PARTITION BY (network, toStartOfMonth(timestamp))
ORDER BY (network, probe_location, sp_address, timestamp)
PRIMARY KEY (network, probe_location, sp_address, timestamp)
TTL toDateTime(timestamp) + INTERVAL 1 YEAR`,
      );
      expect(statements).toContain(`INSERT INTO ${replacement} SELECT * FROM ${source}`);
      expect(statements).toContain(`EXCHANGE TABLES ${source} AND ${replacement}`);
      expect(statements).toContain(`DROP TABLE ${replacement} SYNC`);
    }
  });
});
