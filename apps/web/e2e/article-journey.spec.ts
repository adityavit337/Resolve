import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

function fixture(action: "create" | "cleanup", marker: string) {
  const output = execFileSync(process.execPath, ["--conditions=react-server", "--env-file=.env", "scripts/browser-fixture.ts", action, marker], { encoding: "utf8" });
  return output ? JSON.parse(output) as { email: string; password: string; workspaceId: number } : null;
}

test("staff creates, edits, publishes, reloads, and withdraws a help article", async ({ page }) => {
  const marker = randomUUID();
  const account = fixture("create", marker)!;
  try {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Ticket inbox" })).toBeVisible();
    await page.getByRole("link", { name: "Help articles", exact: true }).click();
    await expect(page.getByText("No help articles yet. Create your first draft below.")).toBeVisible();
    await page.getByLabel("Title", { exact: true }).fill(`Guide ${marker}`);
    await page.getByLabel("Article body").fill("<script>plain article text</script>");
    await page.getByRole("button", { name: "Create draft", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Draft saved." })).toBeVisible();
    await expect(page.locator("article")).toContainText("<script>plain article text</script>");
    await expect(page.locator("article script")).toHaveCount(0);
    await page.getByLabel("Title", { exact: true }).fill(`Edited guide ${marker}`);
    await page.getByLabel("Publication status").selectOption("PUBLISHED");
    await page.getByRole("button", { name: "Save article", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Article published." })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: `Edited guide ${marker}`, exact: true }).click();
    await expect(page.getByLabel("Publication status")).toHaveValue("PUBLISHED");
    await expect(page.getByLabel("Article body")).toHaveValue("<script>plain article text</script>");
    await page.getByLabel("Search published articles").fill("guide");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText("Up to 20 published matches", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: `Edited guide ${marker}`, exact: true })).toBeVisible();
    await page.getByLabel("Publication status").selectOption("DRAFT");
    await page.getByRole("button", { name: "Save article", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Draft saved." })).toBeVisible();
    await expect(page.getByText("No published articles match this search.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Show all articles", exact: true }).click();
    await expect(page.getByRole("button", { name: `Edited guide ${marker}`, exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: `Edited guide ${marker}`, exact: true }).click();
    await expect(page.getByLabel("Publication status")).toHaveValue("DRAFT");
  } finally { fixture("cleanup", marker); }
});
