// Phase 002 browser test: customers + AI assistant (against a LOCAL stack with a mock AI provider).
// Usage: E2E_BASE_URL=http://localhost:3100 E2E_EMAIL=... E2E_PASSWORD=... node tests/e2e/phase2.mjs
// Expects: email auto-confirm, AI_PROVIDER_OPENAI_BASE_URL pointing at tests/e2e/mock-openai.mjs.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OUT = process.env.E2E_OUT ?? "test-results/e2e";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const results = [];
const check = (n, c) => { results.push([n, !!c]); console.log(c ? "✔" : "✘", n); };
const hook = process.env.E2E_HOOK_URL;
const visible = (locator, timeout = 8000) => locator.first().waitFor({ state: "visible", timeout }).then(() => true, () => false); // optional local helper to flip mock/DB state

try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Register + onboard
  await page.goto(`${BASE}/register`);
  await page.fill("#firstName", "Pia");
  await page.fill("#email", process.env.E2E_EMAIL);
  await page.fill("#password", process.env.E2E_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL("**/onboarding");
  await page.fill("#name", "Boland Test Cleaning");
  await page.click("button[type=submit]");
  await page.waitForURL("**/app/today");
  check("owner onboarded", true);
  check("Today shows live 'New customers this week' tile", await visible(page.getByText("New customers this week")));

  // Customers — empty state, create with contact + site
  await page.goto(`${BASE}/app/sales/customers`);
  check("customers empty state", await visible(page.getByText("No customers yet")));
  await page.getByRole("button", { name: "New customer" }).first().click();
  await page.fill("#displayName", "ABC Construction");
  await page.fill("#phone", "082 555 1234");
  await page.fill("#email", "info@abc.co.za");
  await page.getByText("Contact person and site address").click();
  await page.fill("#contactFirstName", "Pieter");
  await page.fill("#line1", "12 Dorp Street");
  await page.fill("#city", "Stellenbosch");
  await page.getByRole("button", { name: "Add customer" }).click();
  await page.waitForURL(/\/app\/sales\/customers\/[0-9a-f-]{36}/);
  await page.getByRole("heading", { name: "ABC Construction" }).waitFor();
  check("customer created with detail page", true);
  const abcUrl = page.url();
  check("WhatsApp button uses international number", (await page.getByRole("link", { name: "WhatsApp" }).getAttribute("href")) === "https://wa.me/27825551234");
  await page.goto(`${abcUrl}?tab=contacts`);
  const contacts = page.getByRole("region", { name: "Contacts" });
  check("primary contact created atomically", await contacts.getByText("Pieter").isVisible() && await contacts.getByText("Primary").isVisible());
  await page.goto(`${abcUrl}?tab=sites`);
  check("site address created", await visible(page.getByRole("region", { name: "Sites and addresses" }).getByText("12 Dorp Street, Stellenbosch")));
  await page.screenshot({ path: `${OUT}/p2-01-customer-detail.png`, fullPage: true });

  // Duplicate warning
  await page.goto(`${BASE}/app/sales/customers?new=1`);
  await page.fill("#displayName", "Someone Else");
  await page.fill("#phone", "+27825551234");
  await page.locator("#email").focus();
  await page.getByText("Possible existing customer").waitFor();
  check("duplicate warning by phone (local vs +27)", await visible(page.getByRole("link", { name: "ABC Construction" })));
  await page.getByRole("button", { name: "Add customer" }).click();
  check("cannot save duplicate without ticking 'different customer'", await visible(page.getByText("This looks like an existing customer")));
  await page.screenshot({ path: `${OUT}/p2-02-duplicate.png` });
  await page.keyboard.press("Escape");

  // Task linked to customer
  await page.goto(`${abcUrl}?tab=tasks`);
  await page.getByRole("link", { name: "New task" }).click();
  await page.getByRole("dialog", { name: "New task" }).waitFor();
  check("task form preselects the customer", (await page.locator("#customerId").inputValue()).length === 36);
  await page.fill("#title", "Quote follow-up for ABC");
  await page.getByRole("button", { name: "Create task" }).click();
  await page.getByText("Task created").waitFor();
  check("task row links to customer", await visible(page.getByRole("link", { name: "ABC Construction", exact: true })));
  await page.goto(`${abcUrl}?tab=tasks`);
  check("customer page lists its tasks", await visible(page.getByText("Quote follow-up for ABC")));

  // AI: create customer via natural language
  await page.goto(`${BASE}/app/today`);
  await page.fill("#ai-command", "Add Riverside Lodge as a customer, contact Anna, 082 111 2222");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("Added Riverside Lodge as a customer.").waitFor({ timeout: 20000 });
  check("AI created a customer from plain language", true);
  check("AI result card has Open link", await visible(page.getByRole("link", { name: /Created Riverside Lodge/ })));
  check("AI result card has Undo", await visible(page.getByRole("button", { name: "Undo" })));
  await page.screenshot({ path: `${OUT}/p2-03-ai-create.png` });
  await page.getByRole("link", { name: /Created Riverside Lodge/ }).click();
  await page.getByText("Added by AI").waitFor();
  check("AI-created customer is labelled 'Added by AI'", true);
  await page.goto(`${page.url().split("?")[0]}?tab=activity`);
  check("activity shows the AI as actor", await visible(page.getByText(/The assistant added customer “Riverside Lodge”/)));

  // AI: duplicate guard
  await page.fill("#ai-command", "Add ABC Construction as a customer");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText(/looks like an existing customer: ABC Construction/).waitFor({ timeout: 20000 });
  check("AI refuses to create a duplicate and asks", true);

  // AI: read
  await page.fill("#ai-command", "find Riverside");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("Found: Riverside Lodge.").waitFor({ timeout: 20000 });
  check("AI read answers from real data", true);

  // Screen context: "this customer" resolves to the record on screen (verified server-side via RLS)
  await page.goto(`${BASE}/app/sales/customers?q=ABC`);
  await page.getByRole("link", { name: "ABC Construction", exact: true }).click();
  await page.waitForURL(/\/app\/sales\/customers\/[0-9a-f-]{36}/);
  await page.fill("#ai-command", "tell me about this customer");
  await page.getByRole("button", { name: "Send" }).click();
  check("assistant understands 'this customer' from the current screen", await visible(page.getByText("You're looking at ABC Construction."), 20000));

  // AI: consequential → confirmation, nothing changes until confirmed
  await page.fill("#ai-command", "archive Riverside Lodge");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText(/Please confirm: Archive customer “Riverside Lodge”/).waitFor({ timeout: 20000 });
  check("CONSEQUENTIAL archive asks for confirmation", await visible(page.getByRole("button", { name: "Confirm" })));
  await page.screenshot({ path: `${OUT}/p2-04-ai-confirm.png` });
  await page.goto(`${BASE}/app/sales/customers?q=Riverside`);
  check("nothing archived before confirmation", await visible(page.getByRole("link", { name: "Riverside Lodge", exact: true })));
  await page.goto(`${BASE}/app/today`);
  await page.fill("#ai-command", "archive Riverside Lodge");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "Confirm" }).click({ timeout: 20000 });
  await page.getByText("Done.").waitFor({ timeout: 20000 });
  await page.goto(`${BASE}/app/sales/customers?q=Riverside`);
  check("confirmed archive applied", await visible(page.getByText("No customers match your search")));

  // Usage page
  await page.goto(`${BASE}/app/settings/ai`);
  check("AI usage page shows spend and limits", await visible(page.getByText("Hard ceiling", { exact: true })) && await visible(page.getByText("US$2.0000")));
  check("AI status Active", await visible(page.getByText("Active", { exact: true })));
  await page.screenshot({ path: `${OUT}/p2-05-ai-usage.png`, fullPage: true });

  // Hard ceiling + provider outage are toggled by the harness, then verified here
  if (hook) {
    await fetch(`${hook}/hard-limit`);
    await page.goto(`${BASE}/app/today`);
    await page.fill("#ai-command", "find ABC");
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByText(/AI is paused for the rest of this month/).waitFor({ timeout: 20000 });
    check("hard ceiling blocks further AI calls with a clear message", true);
    await fetch(`${hook}/reset-limit`);
    await fetch(`${hook}/provider-down`);
    await page.fill("#ai-command", "find ABC");
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByText(/assistant isn't available right now/).waitFor({ timeout: 20000 });
    check("provider outage fails gracefully", true);
    await page.goto(`${BASE}/app/sales/customers`);
    check("app keeps working during AI outage", await visible(page.getByRole("link", { name: "ABC Construction", exact: true })));
    await fetch(`${hook}/provider-up`);
  }

  // Mobile
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.context().addCookies(await page.context().cookies());
  await m.goto(`${BASE}/app/sales/customers`);
  await m.screenshot({ path: `${OUT}/p2-06-customers-mobile.png`, fullPage: true });
  check("mobile customer list renders", await visible(m.getByRole("link", { name: "ABC Construction", exact: true })));
  await m.getByRole("button", { name: "Quick actions" }).click();
  check("mobile quick action 'Create customer' is live", await visible(m.getByRole("button", { name: /Create customer/ })) && !(await m.getByRole("button", { name: /Create customer soon/ }).count()));

  if (errors.length) console.error("PAGE ERRORS:", errors);
  check("no uncaught page errors", errors.length === 0);
} catch (e) {
  console.error("E2E aborted:", e.message);
  results.push(["completed without exception", false]);
} finally {
  await browser.close();
}
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
