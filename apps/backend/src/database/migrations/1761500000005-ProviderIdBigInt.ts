import type { MigrationInterface, QueryRunner } from "typeorm";

export class ProviderIdBigInt1761500000005 implements MigrationInterface {
  name = "ProviderIdBigInt1761500000005";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE TABLE storage_providers ALTER COLUMN "providerId" TYPE TEXT USING storage_providers.providerId`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE TABLE storage_providers ALTER COLUMN "providerId" TYPE INTEGER USING storage_providers.providerId`,
    );
  }
}
