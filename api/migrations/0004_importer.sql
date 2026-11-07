-- Importing needs a user, and a document can be private. apikey is Better Auth's API key
-- plugin's; src/smoke-key.ts writes the system user's key, for the smoke test.
CREATE TABLE "apikey" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "configId" TEXT NOT NULL,
  "name" TEXT,
  "start" TEXT,
  "referenceId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "prefix" TEXT,
  "key" TEXT NOT NULL,
  "refillInterval" INTEGER,
  "refillAmount" INTEGER,
  "lastRefillAt" TEXT CHECK ("lastRefillAt" IS strftime('%Y-%m-%dT%H:%M:%fZ', "lastRefillAt")),
  "enabled" INTEGER,
  "rateLimitEnabled" INTEGER,
  "rateLimitTimeWindow" INTEGER,
  "rateLimitMax" INTEGER,
  "requestCount" INTEGER,
  "remaining" INTEGER,
  "lastRequest" TEXT CHECK ("lastRequest" IS strftime('%Y-%m-%dT%H:%M:%fZ', "lastRequest")),
  "expiresAt" TEXT CHECK ("expiresAt" IS strftime('%Y-%m-%dT%H:%M:%fZ', "expiresAt")),
  "createdAt" TEXT NOT NULL CHECK ("createdAt" IS strftime('%Y-%m-%dT%H:%M:%fZ', "createdAt")),
  "updatedAt" TEXT NOT NULL CHECK ("updatedAt" IS strftime('%Y-%m-%dT%H:%M:%fZ', "updatedAt")),
  "permissions" TEXT,
  "metadata" TEXT
) STRICT;

CREATE INDEX "apikey_configId_idx" ON "apikey" ("configId");
CREATE INDEX "apikey_referenceId_idx" ON "apikey" ("referenceId");
CREATE INDEX "apikey_key_idx" ON "apikey" ("key");

-- skolia.io itself: the importer of texts from before importing needed a user, and of the
-- smoke test's
INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
VALUES ('system', 'skolia.io', 'system@skolia.io', 0, NULL, '2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');

ALTER TABLE document RENAME TO old_document;

CREATE TABLE document (
  id TEXT NOT NULL PRIMARY KEY,
  title TEXT NOT NULL,
  lang TEXT NOT NULL,
  imported TEXT NOT NULL CHECK (imported IS strftime('%Y-%m-%dT%H:%M:%fZ', imported)),
  words INTEGER NOT NULL,
  importer TEXT NOT NULL REFERENCES "user" ("id"),
  -- private: left out of the library, except the importer's. Anyone with the id can still open it.
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private'))
) STRICT;

-- The smoke tests' texts are private
INSERT INTO document (id, title, lang, imported, words, importer, visibility)
SELECT id, title, lang, imported, words, 'system',
       CASE WHEN title LIKE 'smoke test %' THEN 'private' ELSE 'public' END
FROM old_document;

DROP TABLE old_document;
