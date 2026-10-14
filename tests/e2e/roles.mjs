// Role-based UI smoke test. Requires dev seed (supabase/seed/dev_seed.sql) on a LOCAL stack.
import { chromium } from "playwright";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const results = [];
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
  check("field agent: activity history hidden", await field.getByText("isn't available for your role").isVisible());
  await field.goto(`${BASE}/app/money/invoices`);
  check("field agent: direct URL to Money is blocked", await field.getByText("You don't have access to this area").isVisible());
  await field.goto(`${BASE}/app/work/tasks`);
  check("field agent: sees only own assigned task", (await field.getByText("[Demo]").count()) === 1);

  const viewer = await as("viewer@seed.veritaro.test");
  await viewer.goto(`${BASE}/app/work/tasks`);
  check("viewer: sees org tasks", (await viewer.getByText("[Demo]").count()) === 3);
  check("viewer: cannot create tasks (no button)", !(await viewer.getByRole("button", { name: "New task" }).isVisible()));
  check("viewer: never sees other organisation's task", !(await viewer.getByText("Other org").isVisible()));
  await viewer.goto(`${BASE}/app/settings/organisation`);
  check("viewer: organisation form is read-only", await viewer.getByText("Only owners and admins can change them").isVisible());

  const admin = await as("admin@seed.veritaro.test");
  await admin.goto(`${BASE}/app/settings/members`);
  check("admin: owner row is not editable", !(await admin.getByRole("combobox", { name: /Role for Olivia/ }).isVisible()));
  check("admin: can edit non-owner roles", await admin.getByRole("combobox", { name: /Role for Fred/ }).isVisible());
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
