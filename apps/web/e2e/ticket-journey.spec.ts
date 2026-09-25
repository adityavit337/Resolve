import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

function fixture(action: "create" | "inspect" | "cleanup", marker: string): unknown {
  const output = execFileSync(process.execPath, [
    "--conditions=react-server", "--env-file=.env", "scripts/browser-fixture.ts", action, marker,
  ], { cwd: process.cwd(), encoding: "utf8" });
  return output ? JSON.parse(output) as unknown : null;
}

type CreatedFixture = { email: string; password: string; userId: number; workspaceId: number; subject: string };
type SavedTicket = { status: string; priority: string; assigneeId: number | null; version: number; messageKinds: string[]; changeFields: string[] };

test("staff member takes a ticket from creation to resolution", async ({ page }) => {
  // The fixture helper rejects non-local databases before writing anything.
  const marker = randomUUID();
  const { email, password, userId, subject } = fixture("create", marker) as CreatedFixture;
  const note = `Internal observation ${marker}`;
  const reply = `Public reply ${marker}`;

  try {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Ticket inbox" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No tickets yet." })).toBeVisible();

    await page.getByLabel("Subject", { exact: true }).fill(subject);
    await page.getByLabel("Description", { exact: true }).fill("A customer issue for the browser journey.");
    await page.getByRole("button", { name: "Create ticket" }).click();
    await expect(page.getByRole("link", { name: subject })).toBeVisible();
    await page.getByRole("link", { name: subject }).click();
    await expect(page.getByRole("heading", { name: subject })).toBeVisible();

    await page.locator("#message-body").fill(note);
    await page.getByRole("button", { name: "Save internal note" }).click();
    await expect(page.getByText(note)).toBeVisible();
    await page.locator("#message-kind").selectOption("PUBLIC_REPLY");
    await page.locator("#message-body").fill(reply);
    await page.getByRole("button", { name: "Save public reply" }).click();
    await expect(page.getByText(reply)).toBeVisible();

    await page.locator("#assignee").selectOption(String(userId));
    await page.locator("#priority").selectOption("HIGH");
    await page.locator("#ticket-status").selectOption("IN_PROGRESS");
    await page.getByRole("button", { name: "Save workflow" }).click();
    await expect(page.locator("#ticket-status")).toHaveValue("IN_PROGRESS");
    await expect(page.locator("#priority")).toHaveValue("HIGH");

    await page.locator("#ticket-status").selectOption("RESOLVED");
    await page.getByRole("button", { name: "Save workflow" }).click();
    await expect(page.locator("#ticket-status")).toHaveValue("RESOLVED");
    await page.reload();
    await expect(page.locator("#ticket-status")).toHaveValue("RESOLVED");
    await expect(page.getByText(note)).toBeVisible();
    await expect(page.getByText(reply)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Change history" })).toBeVisible();

    await page.getByRole("link", { name: "Back to tickets" }).click();
    await page.locator("#ticket-search").fill(subject);
    await page.locator("#filter-status").selectOption("RESOLVED");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByRole("link", { name: subject })).toBeVisible();
    await expect(page.getByText("1 matching ticket. Showing 1 on page 1 of 1.")).toBeVisible();

    const saved = fixture("inspect", marker) as SavedTicket | null;
    expect(saved).not.toBeNull();
    expect(saved?.status).toBe("RESOLVED");
    expect(saved?.priority).toBe("HIGH");
    expect(saved?.assigneeId).toBe(userId);
    expect(saved?.version).toBe(2);
    expect(saved?.messageKinds).toEqual(["INTERNAL_NOTE", "PUBLIC_REPLY"]);
    expect(saved?.changeFields).toEqual(["ASSIGNEE", "PRIORITY", "STATUS", "STATUS"]);
  } finally {
    fixture("cleanup", marker);
  }
});
