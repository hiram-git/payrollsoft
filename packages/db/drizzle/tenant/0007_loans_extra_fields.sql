ALTER TABLE "loans" ADD COLUMN "loan_type" varchar(50);
--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "frequency" varchar(20);
--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "creditor" varchar(255);
--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "allow_december" boolean DEFAULT true NOT NULL;
