import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddPieceConfirmedStatus1760000000001 implements MigrationInterface {
  name = "AddPieceConfirmedStatus1760000000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_enum
          WHERE enumlabel = 'piece_confirmed'
            AND enumtypid = 'deals_status_enum'::regtype
        ) THEN
          ALTER TYPE deals_status_enum ADD VALUE 'piece_confirmed' AFTER 'piece_added';
        END IF;
      END $$;
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Postgres enums do not support removing values without type recreation.
  }
}
