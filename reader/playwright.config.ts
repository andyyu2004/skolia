// Screenshots of the reader's pages against a mocked API (screenshots/api.ts), to see
// what a change does to how they look. Fonts render differently on each OS, so the
// screenshots are taken in Playwright's Linux image: just screenshots, or
// just screenshots --update-snapshots to accept a change. The reader is built first.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "screenshots",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.001 },
  },
  use: {
    baseURL: "http://skolia.test",
    locale: "en-GB",
    timezoneId: "UTC",
  },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "desktop-dark", use: { viewport: { width: 1280, height: 800 }, colorScheme: "dark" } },
  ],
});
