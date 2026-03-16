import type { MigrationInterface, QueryRunner } from "typeorm";

export class ProviderIdBigInt1761500000005 implements MigrationInterface {
  name = "ProviderIdBigInt1761500000005";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE storage_providers ALTER COLUMN "providerId" TYPE TEXT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE storage_providers ALTER COLUMN "providerId" TYPE INTEGER`,
    );
  }
}
