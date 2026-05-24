import { test, expect } from "@playwright/test";

test("lookahead create + edit + delete flow", async ({ page }) => {
  test.setTimeout(120_000);
  // Sign in
  await page.goto("/login");
  await page.getByLabel("Email").fill("scheduler@ihs.test");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Land on the schedule
  await expect(page.getByText("Riverside Office Build")).toBeVisible({ timeout: 10_000 });

  // Switch to Lookahead view
  await page.getByRole("button", { name: "Lookahead" }).click();

  // Open New Lookahead modal
  await page.getByRole("button", { name: /New Lookahead/ }).click();
  await expect(page.getByRole("heading", { name: /New Lookahead/ })).toBeVisible();

  // Fill the form. Wide window so something gets auto-populated.
  const unique = `E2E ${Date.now()}`;
  await page.getByLabel(/Name/).fill(unique);
  await page.getByLabel(/Window start/).fill("2026-05-01");
  await page.getByLabel(/Window end/).fill("2026-06-30");

  await page.getByRole("button", { name: /Create/ }).click();

  // Modal closes, lookahead appears in dropdown
  await expect(page.getByRole("heading", { name: /New Lookahead/ })).not.toBeVisible();
  await expect(page.getByRole("combobox").first()).toContainText(unique, { timeout: 10_000 });

  // The table has tasks (auto-populated) — assert footer "+ Add Task" appears
  await expect(page.getByRole("button", { name: /Add Task/ }).last()).toBeVisible();

  // Edit one task's % complete.
  // Double-click the % Comp span (first row, first cell showing a %),
  // then fill the number input that replaces it.
  const firstTaskRow = page.locator("tbody tr").first();
  const pctSpan = firstTaskRow.locator("td span", { hasText: /^\d+%$/ }).first();
  await pctSpan.dblclick();
  // The span swaps for an input; the percent input has no aria-label (unlike offset inputs).
  const pctInput = firstTaskRow.locator("td input[type='number']:not([aria-label])");
  await pctInput.fill("50");
  await pctInput.blur();

  // Reload to confirm persistence
  await page.reload();
  await page.getByRole("button", { name: "Lookahead" }).click();
  // Reselect our unique lookahead from the dropdown (default selection may be different).
  // Find the option whose text contains the unique name and select it by value.
  const combobox = page.getByRole("combobox").first();
  const lookaheadValue = await combobox.locator(`option:has-text("${unique}")`).getAttribute("value");
  await combobox.selectOption(lookaheadValue as string);
  await expect(page.locator("td", { hasText: /^50%$/ }).first()).toBeVisible({ timeout: 5_000 });

  // Add a detached task (default name "New task", detached, today/today)
  await page.getByRole("button", { name: /Add Task/ }).last().click();
  // The new row has "Detached" + "New task" — rename to "Safety meeting"
  const detachedRow = page.locator("tr", { hasText: /Detached/ }).last();
  await detachedRow.getByText("New task").dblclick();
  const nameInput = detachedRow.locator("input").first();
  await nameInput.fill("Safety meeting");
  await nameInput.press("Enter");
  await expect(detachedRow.getByText("Safety meeting")).toBeVisible();

  // Delete the detached task
  await detachedRow.getByRole("button", { name: /Delete/ }).click();
  await expect(page.locator("tr", { hasText: "Safety meeting" })).not.toBeVisible();

  // Delete the whole lookahead
  await page.getByRole("button", { name: /Delete Lookahead/ }).click();

  // Dropdown returns to default (unique lookahead is gone)
  await expect(page.getByRole("combobox").first()).not.toContainText(unique);
});
