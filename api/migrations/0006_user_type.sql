-- system: skolia.io's own accounts, outside the daily import cap. Everyone else is standard.
ALTER TABLE "user" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'standard' CHECK ("type" IN ('standard', 'system'));

UPDATE "user" SET "type" = 'system' WHERE "id" = 'system';

-- The importer of the curated texts in texts/ (src/seed.ts)
INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt", "type")
VALUES ('curated', 'skolia.io', 'curated@skolia.io', 0, NULL, '2026-11-08T00:00:00.000Z', '2026-11-08T00:00:00.000Z', 'system');
