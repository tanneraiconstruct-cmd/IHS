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
