import { test, expect } from "@playwright/test";

test("scheduler happy path", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("scheduler@ihs.test");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Lands on the schedule
  await expect(page.getByText("Riverside Office Build")).toBeVisible({ timeout: 10_000 });

  // Critical-path toggle
  await page.getByRole("button", { name: /Critical path/ }).click();
  await expect(page.getByRole("button", { name: /Critical path/, pressed: true })).toBeVisible();

  // Switch to List view
  await page.getByRole("button", { name: "List" }).click();
  await expect(page.getByText("Mobilize").first()).toBeVisible();

  // Switch to Calendar view
  await page.getByRole("button", { name: "Calendar" }).click();
  await expect(page.locator("text=Mobilize").first()).toBeVisible();

  // Switch back to Gantt
  await page.getByRole("button", { name: "Gantt" }).click();

  // Enter edit mode
  await page.getByRole("button", { name: /Edit mode/ }).click();
  await expect(page.getByText("Edit mode")).toBeVisible();

  // (Manual drag E2E is left to a follow-up; this test verifies plumbing.)
});

test("session note + edit + delete comment flow", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("scheduler@ihs.test");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Riverside Office Build")).toBeVisible({ timeout: 10_000 });

  // Enter Edit Mode.
  await page.getByRole("button", { name: /Edit mode/ }).click();
  await expect(page.getByText("Edit mode")).toBeVisible();

  // Make 2 inline name edits via double-click on activity name cells.
  const firstCell = page.locator('[data-testid="activity-name-cell"]').first();
  await firstCell.dblclick();
  await page.keyboard.type(" v1");
  await page.keyboard.press("Tab");

  const secondCell = page.locator('[data-testid="activity-name-cell"]').nth(1);
  await secondCell.dblclick();
  await page.keyboard.type(" v1");
  await page.keyboard.press("Tab");

  // Click Done → modal appears.
  await page.getByRole("button", { name: /^done$/i }).click();
  const modal = page.locator(".fixed").filter({ hasText: "Add a note for this session?" });
  await expect(modal).toBeVisible();
  const noteTextarea = modal.getByPlaceholder(/re-sequenced concrete/i);
  await noteTextarea.fill("re-sequenced concrete");
  await modal.getByRole("button", { name: /^save$/i }).click();

  // Banner gone; group card visible with change count and note text.
  await expect(page.getByText("Edit mode")).not.toBeVisible();
  await expect(page.getByText(/made \d+ changes/i)).toBeVisible();
  await expect(page.getByText("re-sequenced concrete")).toBeVisible();

  // Expand the group to see detail rows.
  await page.getByRole("button", { name: /^expand$/i }).click();
  await expect(page.locator('[class*="border-t"]').filter({ hasText: "activity." }).first()).toBeVisible();

  // Post a project-level comment.
  const composer = page.getByPlaceholder(/Add a project comment/i);
  await composer.fill("typo here");
  await page.getByRole("button", { name: /^post$/i }).click();
  await expect(page.getByText("typo here")).toBeVisible();

  // Edit the comment in place.
  await page.getByText("typo here").hover();
  await page.getByRole("button", { name: /^edit$/i }).click();
  const editTextarea = page.getByRole("textbox").last();
  await editTextarea.fill("typo fixed");
  await page.getByRole("button", { name: /^save$/i }).last().click();
  await expect(page.getByText("typo fixed")).toBeVisible();
  await expect(page.getByText(/\(edited\)/i)).toBeVisible();

  // Soft-delete the comment.
  await page.getByText("typo fixed").hover();
  await page.getByRole("button", { name: /^delete$/i }).click();
  await expect(page.getByText(/\[deleted by author\]/i)).toBeVisible();
});
