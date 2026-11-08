import assert from "node:assert/strict";
import { test } from "node:test";
import { versionUrl } from "./version.ts";

const REPO = "https://github.com/skolia-io/skolia";

test("a build links to the log up to its tag or commit", () => {
  assert.equal(versionUrl("v0.0.2"), `${REPO}/commits/v0.0.2`);
  assert.equal(versionUrl("v0.0.2-dirty"), `${REPO}/commits/v0.0.2`);
  assert.equal(versionUrl("v0.0.2-16-g3231f8c"), `${REPO}/commits/3231f8c`);
  assert.equal(versionUrl("v0.0.2-16-g3231f8c-dirty"), `${REPO}/commits/3231f8c`);
  assert.equal(versionUrl("v1.0.0-rc1"), `${REPO}/commits/v1.0.0-rc1`);
  assert.equal(versionUrl("v1.0.0-rc1-2-gabcdef0"), `${REPO}/commits/abcdef0`);
  assert.equal(versionUrl("3231f8c"), `${REPO}/commits/3231f8c`);
  assert.equal(versionUrl("3231f8c-dirty"), `${REPO}/commits/3231f8c`);
});

test("dev isn't a build, so it has no link", () => {
  assert.equal(versionUrl("dev"), null);
});
