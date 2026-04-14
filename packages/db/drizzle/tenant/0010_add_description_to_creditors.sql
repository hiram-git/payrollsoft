-- Migration 0010: Add description column to creditors table

ALTER TABLE "creditors" ADD COLUMN "description" text;
