-- Normalise legacy payroll statuses to new state machine values
UPDATE "payrolls" SET "status" = 'created'   WHERE "status" IN ('draft');
--> statement-breakpoint
UPDATE "payrolls" SET "status" = 'created'   WHERE "status" = 'processing';
--> statement-breakpoint
UPDATE "payrolls" SET "status" = 'generated' WHERE "status" = 'processed';
--> statement-breakpoint
UPDATE "payrolls" SET "status" = 'closed'    WHERE "status" = 'paid';
