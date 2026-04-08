import type { MigrationInterface, QueryRunner } from "typeorm";

export class DataSetIdBigInt1761500000006 implements MigrationInterface {
  name = "DataSetIdBigInt1761500000006";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE deals ALTER COLUMN data_set_id TYPE TEXT`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE deals ALTER COLUMN data_set_id TYPE INTEGER USING data_set_id::integer`);
  }
}
