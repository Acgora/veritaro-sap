// Role-based UI smoke test. Requires dev seed (supabase/seed/dev_seed.sql) on a LOCAL stack.
import { chromium } from "playwright";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const results = [];
const visible = (locator, timeout = 8000) => locator.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);
const check = (n, c) => { results.push([n, !!c]); console.log(c ? "✔" : "✘", n); };
async function as(email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`);
  await p.fill("#email", email);
  await p.fill("#password", "DevPassw0rd!");
  await p.click("button[type=submit]");
  await p.waitForURL("**/app/today");
  return p;
}
try {
  const field = await as("field@seed.veritaro.test");
  const nav = field.getByRole("navigation", { name: "Main" }).first();
  check("field agent: Money hidden from navigation", !(await nav.getByRole("link", { name: "Money" }).isVisible()));
  check("field agent: activity history hidden", await visible(field.getByText("isn't available for your role")));
  await field.goto(`${BASE}/app/money/invoices`);
  check("field agent: direct URL to Money is blocked", await visible(field.getByText("You don't have access to this area")));
  await field.goto(`${BASE}/app/work/tasks`);
  await visible(field.getByText("[Demo] Restock chemicals van 2"));
  check("field agent: sees only own assigned tasks",
    (await field.getByText("[Demo] Restock chemicals van 2").count()) === 1 && (await field.getByText("[Demo] Deep clean Block A").count()) === 1
    && (await field.getByText("[Demo] Renew public liability insurance").count()) === 0);
  await field.goto(`${BASE}/app/sales/customers/d2000000-0000-4000-8000-000000000001`);
  check("field agent: can open the customer linked to their task", await visible(field.getByRole("heading", { name: "[Demo] Oakridge Office Park" })));
  await field.goto(`${BASE}/app/sales/customers/d2000000-0000-4000-8000-000000000002`);
  check("field agent: cannot open an unlinked customer", await visible(field.getByText("couldn't find that customer")));

  const viewer = await as("viewer@seed.veritaro.test");
  await viewer.goto(`${BASE}/app/work/tasks`);
  check("viewer: sees org tasks", (await viewer.getByText("[Demo]").count()) >= 4);
  check("viewer: cannot create tasks (no button)", !(await viewer.getByRole("button", { name: "New task" }).isVisible()));
  check("viewer: never sees other organisation's task", !(await viewer.getByText("Other org").isVisible()));
  await viewer.goto(`${BASE}/app/settings/organisation`);
  check("viewer: organisation form is read-only", await visible(viewer.getByText("Only owners and admins can change them")));

  const admin = await as("admin@seed.veritaro.test");
  await admin.goto(`${BASE}/app/settings/members`);
  check("admin: owner row is not editable", !(await admin.getByRole("combobox", { name: /Role for Olivia/ }).isVisible()));
  check("admin: can edit non-owner roles", await visible(admin.getByRole("combobox", { name: /Role for Fred/ })));
  const opts = await admin.getByRole("combobox", { name: /Role for Fred/ }).locator("option").allTextContents();
  check("admin: cannot offer Owner role", !opts.includes("Owner"));
} catch (e) {
  console.error("aborted:", e.message);
  results.push(["completed", false]);
} finally {
  await browser.close();
}
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
