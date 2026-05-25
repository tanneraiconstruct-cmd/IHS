import { test, expect, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Riverside Office Build")).toBeVisible({ timeout: 15_000 });
}

test("two users see each other's schedule + comment changes live", async ({ browser }) => {
  // This test involves two separate browser contexts + realtime round-trips; needs extra time.
  test.setTimeout(120_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();

  await signIn(alice, "scheduler@ihs.test");
  await signIn(bob, "tp-editor@trade.test");

  // Wait for the realtime channel to connect (connection dot turns "live").
  await expect(alice.getByTestId("presence-connection")).toHaveAttribute("data-status", "live", { timeout: 20_000 });
  await expect(bob.getByTestId("presence-connection")).toHaveAttribute("data-status", "live", { timeout: 20_000 });

  // Both should see at least one presence avatar (their own) within ~5s of subscribing.
  await expect(alice.getByTestId("presence-avatar").first()).toBeVisible({ timeout: 15_000 });
  await expect(bob.getByTestId("presence-avatar").first()).toBeVisible({ timeout: 15_000 });

  // Alice should see two avatars (herself + Bob); Bob should see two (himself + Alice).
  // Allow longer timeout for presence sync — sometimes takes a beat after both subscribe.
  await expect(alice.getByTestId("presence-avatar")).toHaveCount(2, { timeout: 15_000 });
  await expect(bob.getByTestId("presence-avatar")).toHaveCount(2, { timeout: 15_000 });

  // ── Comment cross-sync (before any activity selection) ──────────────────────────────────
  // Bob posts a shared comment at project scope (no activity selected = project scope).
  // Alice has no activity selected yet, so her SidePanel shows the project feed.
  const commentText = `hello from bob ${Date.now()}`;
  // Switch visibility to "shared" so Alice (internal user) can see it.
  await bob.getByRole("button", { name: "shared" }).click();
  await bob.getByPlaceholder(/comment/i).first().fill(commentText);
  await bob.getByRole("button", { name: "Post" }).click();
  // Alice sees the comment in her project feed.
  await expect(alice.getByText(commentText)).toBeVisible({ timeout: 15_000 });

  // ── Schedule rename cross-sync ───────────────────────────────────────────────────────────
  // Alice enters Edit Mode and renames the first activity ("Mobilize").
  await alice.getByRole("button", { name: /Edit mode/ }).click();
  // Wait for edit mode to be active.
  await expect(alice.getByRole("button", { name: /Exit edit/ })).toBeVisible({ timeout: 5_000 });
  const renamedTo = `Mobilize — REALTIME ${Date.now()}`;
  // Target the activity-table aside specifically to avoid matching Gantt bar spans.
  const activityTable = alice.locator("aside").first();
  const aliceFirstName = activityTable.locator('span.flex-1.truncate:has-text("Mobilize")').first();
  await expect(aliceFirstName).toBeVisible({ timeout: 5_000 });
  await aliceFirstName.dblclick();
  const aliceInput = alice.locator("input.flex-1").first();
  await expect(aliceInput).toBeVisible({ timeout: 3_000 });
  await aliceInput.fill(renamedTo);
  await aliceInput.press("Enter");

  // Alice should see the rename in her own page (optimistic update).
  await expect(alice.getByText(renamedTo).first()).toBeVisible({ timeout: 5_000 });

  // Bob sees the renamed activity within ~5s via realtime broadcast.
  await expect(bob.getByText(renamedTo).first()).toBeVisible({ timeout: 15_000 });

  // Restore the activity name so subsequent runs aren't polluted.
  await activityTable.locator(`span.flex-1.truncate:has-text("${renamedTo}")`).first().dblclick();
  const undoInput = alice.locator("input.flex-1").first();
  await undoInput.fill("Mobilize");
  await undoInput.press("Enter");

  await ctxA.close();
  await ctxB.close();
});
