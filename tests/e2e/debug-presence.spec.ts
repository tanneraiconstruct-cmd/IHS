import { test, expect, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Riverside Office Build")).toBeVisible({ timeout: 15_000 });
}

test("debug presence", async ({ page }) => {
  await signIn(page, "scheduler@ihs.test");

  // Capture all console messages and failed requests
  const consoleMsgs: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (msg) => {
    consoleMsgs.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedRequests.push(`${response.status()} ${response.url()}`);
    }
  });

  // Wait for schedule to fully load
  await page.waitForTimeout(8000);

  // Log current URL
  const url = page.url();
  console.log("url:", url);
  console.log("console msgs:", JSON.stringify(consoleMsgs.slice(0, 20)));
  console.log("failed requests:", JSON.stringify(failedRequests));

  const dotExists = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="presence-connection"]');
    return { found: !!el, status: el?.getAttribute("data-status") };
  });
  console.log("dot:", JSON.stringify(dotExists));

  // Search for any data-testid attribute
  const allTestids = await page.evaluate(() => {
    const all = document.querySelectorAll('[data-testid]');
    return Array.from(all).map(el => el.getAttribute('data-testid') + ': ' + el.tagName);
  });
  console.log("all testids:", JSON.stringify(allTestids));

  // Check if PresenceBar is in the DOM at all
  const presenceBarCheck = await page.evaluate(() => {
    const headerRight = document.querySelector("header > div:last-child");
    // Also look for anything with "connecting" or "live" class
    const all = document.querySelectorAll('[class*="emerald"],[class*="slate-300"],[class*="red-500"]');
    return {
      rightDivStart: headerRight ? headerRight.innerHTML.substring(0, 500) : "no header right div",
      roundedFullElements: Array.from(all).map(el => ({ tag: el.tagName, class: el.className.substring(0, 80) })).slice(0, 10),
    };
  });
  console.log("presence check:", JSON.stringify(presenceBarCheck, null, 2));

  // Get the right div HTML
  const rightDivHtml = await page.evaluate(() => {
    const header = document.querySelector("header");
    if (!header) return "no header";
    // Get the second div (the right side flex div)
    const divs = header.querySelectorAll(":scope > div");
    const rightDiv = divs[divs.length - 1];
    return rightDiv ? rightDiv.outerHTML : "no right div";
  });
  console.log("right div html:", rightDivHtml);
});
