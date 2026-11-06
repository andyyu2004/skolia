ALTER TABLE document RENAME TO old_document;

CREATE TABLE document (
  id TEXT NOT NULL PRIMARY KEY,
  title TEXT NOT NULL,
  lang TEXT NOT NULL,
  imported TEXT NOT NULL CHECK (imported IS strftime('%Y-%m-%dT%H:%M:%fZ', imported)),
  words INTEGER NOT NULL
) STRICT;

INSERT INTO document (id, title, lang, imported, words)
SELECT id, title, lang, imported, words FROM old_document;

ALTER TABLE "user" RENAME TO old_user;
ALTER TABLE "session" RENAME TO old_session;
ALTER TABLE "account" RENAME TO old_account;
ALTER TABLE "verification" RENAME TO old_verification;

CREATE TABLE "user" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL,
  "image" TEXT,
  "createdAt" TEXT NOT NULL CHECK ("createdAt" IS strftime('%Y-%m-%dT%H:%M:%fZ', "createdAt")),
  "updatedAt" TEXT NOT NULL CHECK ("updatedAt" IS strftime('%Y-%m-%dT%H:%M:%fZ', "updatedAt"))
) STRICT;

CREATE TABLE "session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "expiresAt" TEXT NOT NULL CHECK ("expiresAt" IS strftime('%Y-%m-%dT%H:%M:%fZ', "expiresAt")),
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" TEXT NOT NULL CHECK ("createdAt" IS strftime('%Y-%m-%dT%H:%M:%fZ', "createdAt")),
  "updatedAt" TEXT NOT NULL CHECK ("updatedAt" IS strftime('%Y-%m-%dT%H:%M:%fZ', "updatedAt")),
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
) STRICT;

CREATE TABLE "account" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TEXT CHECK ("accessTokenExpiresAt" IS strftime('%Y-%m-%dT%H:%M:%fZ', "accessTokenExpiresAt")),
  "refreshTokenExpiresAt" TEXT CHECK ("refreshTokenExpiresAt" IS strftime('%Y-%m-%dT%H:%M:%fZ', "refreshTokenExpiresAt")),
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TEXT NOT NULL CHECK ("createdAt" IS strftime('%Y-%m-%dT%H:%M:%fZ', "createdAt")),
  "updatedAt" TEXT NOT NULL CHECK ("updatedAt" IS strftime('%Y-%m-%dT%H:%M:%fZ', "updatedAt"))
) STRICT;

CREATE TABLE "verification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TEXT NOT NULL CHECK ("expiresAt" IS strftime('%Y-%m-%dT%H:%M:%fZ', "expiresAt")),
  "createdAt" TEXT NOT NULL CHECK ("createdAt" IS strftime('%Y-%m-%dT%H:%M:%fZ', "createdAt")),
  "updatedAt" TEXT NOT NULL CHECK ("updatedAt" IS strftime('%Y-%m-%dT%H:%M:%fZ', "updatedAt"))
) STRICT;

INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
SELECT "id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt" FROM old_user;

INSERT INTO "session" ("id", "expiresAt", "token", "createdAt", "updatedAt", "ipAddress", "userAgent", "userId")
SELECT "id", "expiresAt", "token", "createdAt", "updatedAt", "ipAddress", "userAgent", "userId" FROM old_session;

INSERT INTO "account" ("id", "accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope", "password", "createdAt", "updatedAt")
SELECT "id", "accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope", "password", "createdAt", "updatedAt" FROM old_account;

INSERT INTO "verification" ("id", "identifier", "value", "expiresAt", "createdAt", "updatedAt")
SELECT "id", "identifier", "value", "expiresAt", "createdAt", "updatedAt" FROM old_verification;

DROP TABLE old_session;
DROP TABLE old_account;
DROP TABLE old_verification;
DROP TABLE old_user;
DROP TABLE old_document;

CREATE INDEX "session_userId_idx" ON "session" ("userId");
CREATE INDEX "account_userId_idx" ON "account" ("userId");
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
