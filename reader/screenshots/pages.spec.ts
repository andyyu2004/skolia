import { expect, test, type Page } from "@playwright/test";
import { LALKA, serve } from "./api.ts";

/** Opens the page at hash and checks none of the API requests it made failed. */
async function open(page: Page, hash: string, { signedIn = true } = {}): Promise<void> {
  const failed = await serve(page, { signedIn });
  await page.goto(`/${hash}`);
  await page.waitForLoadState("networkidle");
  expect(failed).toEqual([]);
}

test("explore, signed out", async ({ page }) => {
  await open(page, "#/", { signedIn: false });
  await expect(page.getByText("Lalka")).toBeVisible();
  await expect(page).toHaveScreenshot("explore-signed-out.png", { fullPage: true });
});

test("explore", async ({ page }) => {
  await open(page, "#/");
  await expect(page.getByText("Lalka")).toBeVisible();
  await expect(page).toHaveScreenshot("explore.png", { fullPage: true });
});

test("explore, tag filter", async ({ page }) => {
  await open(page, "#/");
  await page.getByLabel("Tags").click();
  await page.getByLabel("level · B1").check();
  await page.getByLabel("level · C1").check();
  await expect(page.getByText("2 texts")).toBeVisible();
  await expect(page).toHaveScreenshot("explore-tag-filter.png");
});

test("account menu", async ({ page }) => {
  await open(page, "#/");
  await page.getByRole("button", { name: "Account: Ada Lovelace" }).click();
  await expect(page.getByText("Signed in as")).toBeVisible();
  await expect(page).toHaveScreenshot("account-menu.png");
});

test("upload", async ({ page }) => {
  await open(page, "#/upload");
  await page.getByLabel("Licence", { exact: true }).selectOption("all-rights-reserved");
  await expect(page).toHaveScreenshot("upload.png", { fullPage: true });
});

test("settings", async ({ page }) => {
  await open(page, "#/settings");
  await expect(page.getByLabel("New cards a day")).toHaveValue("10");
  await expect(page).toHaveScreenshot("settings.png", { fullPage: true });
});

test("review, front", async ({ page }) => {
  await open(page, "#/review");
  await expect(page.getByText("sklep", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("review-front.png", { fullPage: true });
});

test("review, answer", async ({ page }) => {
  await open(page, "#/review");
  await page.getByRole("button", { name: "Show answer" }).click();
  await page.getByText("Forms").click();
  await expect(page).toHaveScreenshot("review-answer.png", { fullPage: true });
});

/** Grades the cards before the cloze card Good, so it's the one shown. */
async function toCloze(page: Page): Promise<void> {
  await open(page, "#/review");
  for (const _ of [0, 1]) {
    await page.getByRole("button", { name: "Show answer" }).click();
    await page.getByRole("button", { name: "Good" }).click();
  }
  await expect(page.getByText("(kolacja)")).toBeVisible();
}

test("review, cloze", async ({ page }) => {
  await toCloze(page);
  await expect(page).toHaveScreenshot("review-cloze.png", { fullPage: true });
});

test("review, cloze answer", async ({ page }) => {
  await toCloze(page);
  await page.getByRole("button", { name: "Show answer" }).click();
  await page.getByText("Forms").click();
  await expect(page).toHaveScreenshot("review-cloze-answer.png", { fullPage: true });
});

test("reader", async ({ page }) => {
  await open(page, `#/doc/${LALKA}`);
  await expect(page.locator("article")).toContainText("W początkach roku 1878");
  await expect(page).toHaveScreenshot("reader.png", { fullPage: true });
});

test("reader, edit dialog", async ({ page }) => {
  await open(page, `#/doc/${LALKA}`);
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Delete…" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveScreenshot("reader-edit.png");
});

// początkach: under w, which gives it its case, so the sheet has a Why and the text a trigger
const WORD = `#/doc/${LALKA}?w=0.1`;

test("word sheet", async ({ page }) => {
  await open(page, WORD);
  await expect(page.getByRole("complementary", { name: "Word details" })).toBeVisible();
  await expect(page).toHaveScreenshot("word-sheet.png");
});

test("word sheet, scrolled", async ({ page, isMobile }) => {
  await open(page, WORD);
  // On a phone the handle gives the sheet the screen; on a desktop it's hidden
  if (isMobile) await page.getByRole("button", { name: "Expand" }).click();
  await page.getByRole("complementary", { name: "Word details" }).evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(page).toHaveScreenshot("word-sheet-end.png");
});

test("sentence, arcs", async ({ page }) => {
  await open(page, `${WORD}&view=sentence`);
  await expect(page.getByRole("group", { name: "Sentence structure" })).toBeVisible();
  await expect(page).toHaveScreenshot("sentence-arcs.png");
});

test("sentence, tree", async ({ page }) => {
  await open(page, `${WORD}&view=sentence&draw=tree&whole=1`);
  await expect(page.getByRole("group", { name: "Sentence structure" })).toBeVisible();
  await expect(page).toHaveScreenshot("sentence-tree.png");
});
