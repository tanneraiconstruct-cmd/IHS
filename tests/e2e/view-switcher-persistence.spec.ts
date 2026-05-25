import { test, expect } from "@playwright/test";

test("filter, selection, and calendar month survive view switches", async ({ page }) => {
  // Sign in.
  await page.goto("/login");
  await page.getByLabel("Email").fill("scheduler@ihs.test");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Riverside Office Build")).toBeVisible({ timeout: 10_000 });

  // Toggle Critical Path ON.
  await page.getByRole("button", { name: /Critical path/ }).click();
  await expect(
    page.getByRole("button", { name: /Critical path/, pressed: true }),
  ).toBeVisible();

  // Switch to List and select the first visible (critical) row.
  await page.getByRole("button", { name: "List" }).click();
  const firstRow = page.locator("tbody tr").first();
  await firstRow.click();
  await expect(firstRow).toHaveClass(/bg-sky-50/);
  const selectedName = (await firstRow.locator("td").first().textContent())?.trim() ?? "";
  expect(selectedName.length).toBeGreaterThan(0);

  // Switch to Calendar; capture the initial month label, advance two months.
  await page.getByRole("button", { name: "Calendar" }).click();
  const monthLabel = page.getByTestId("calendar-month-label");
  await expect(monthLabel).toBeVisible();
  const initialMonth = (await monthLabel.textContent())?.trim() ?? "";
  expect(initialMonth.length).toBeGreaterThan(0);

  const nextMonthBtn = page.getByTestId("calendar-next-month");
  await nextMonthBtn.click();
  await nextMonthBtn.click();

  const advancedMonth = (await monthLabel.textContent())?.trim() ?? "";
  expect(advancedMonth).not.toBe(initialMonth);

  // Switch to Gantt and back; verify Critical Path is still on.
  await page.getByRole("button", { name: "Gantt" }).click();
  await expect(
    page.getByRole("button", { name: /Critical path/, pressed: true }),
  ).toBeVisible();

  // Back to Calendar — assert the month label is still the advanced month.
  await page.getByRole("button", { name: "Calendar" }).click();
  await expect(monthLabel).toHaveText(advancedMonth);

  // Back to List — assert the same row is still highlighted.
  await page.getByRole("button", { name: "List" }).click();
  const rowAfter = page.locator("tbody tr").first();
  await expect(rowAfter).toHaveClass(/bg-sky-50/);
  await expect(rowAfter.locator("td").first()).toHaveText(selectedName);
});
