// End-to-end smoke test against a running app + real Supabase project.
// Usage: E2E_BASE_URL=http://localhost:3100 E2E_EMAIL=... E2E_PASSWORD=... node tests/e2e/smoke.mjs
// The user must exist, be email-confirmed, and have NO organisation yet.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OUT = process.env.E2E_OUT ?? "test-results/e2e";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const results = [];
const visible = (locator, timeout = 8000) => locator.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);
const check = (name, cond) => { results.push([name, !!cond]); if (!cond) console.error("✘", name); else console.log("✔", name); };

try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${BASE}/app/today`);
  check("unauthenticated user is redirected to login", page.url().includes("/login?next="));

  if (process.env.E2E_REGISTER === "1") {
    // Requires email auto-confirm (local stack). Hosted projects send a confirmation email instead.
    await page.goto(`${BASE}/register`);
    await page.fill("#firstName", "Erin");
    await page.fill("#lastName", "Tester");
    await page.fill("#email", process.env.E2E_EMAIL);
    await page.fill("#password", "short");
    await page.click("button[type=submit]");
    await page.getByText("Use at least 8 characters").waitFor();
    check("register validates password length", true);
    await page.fill("#password", process.env.E2E_PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL("**/onboarding");
    check("registration lands on onboarding", true);
    await page.context().clearCookies();
    await page.goto(`${BASE}/app/today`);
  }

  await page.fill("#email", process.env.E2E_EMAIL);
  await page.fill("#password", "wrong-password");
  await page.click("button[type=submit]");
  await page.getByText("Incorrect email or password.").waitFor();
  check("wrong password shows friendly error", true);

  await page.fill("#password", process.env.E2E_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL("**/onboarding");
  check("user without organisation is sent to onboarding", page.url().endsWith("/onboarding"));

  await page.click("button[type=submit]");
  await page.getByText("Enter your business name").waitFor();
  check("onboarding validates business name", true);

  await page.fill("#name", "E2E Cleaning Co");
  await page.click("button[type=submit]");
  await page.waitForURL("**/app/today");
  await page.getByRole("heading", { name: /Good (morning|afternoon|evening), Erin/ }).waitFor();
  check("onboarding creates org and lands on Today with greeting", true);
  check("activity feed shows real organisation_created event", await visible(page.getByText("created the organisation")));
  // Phase 003 rebuilt Today: the "Not set up yet" money tile became a live KPI from today_summary (real zero, no fake values).
  check("money KPI shows a real zero (no fake values)", await visible(page.getByRole("list", { name: "Key numbers" }).getByRole("link", { name: /Money outstanding\s*R\s0,00/ })));
  await page.screenshot({ path: `${OUT}/01-today-desktop.png`, fullPage: true });

  // ⌘K command palette
  await page.keyboard.press("Control+k");
  // Phase 003: the palette also searches records, so its placeholder changed.
  await page.getByPlaceholder("Search customers, quotes, jobs, invoices or pages…").waitFor();
  check("Ctrl+K opens command palette", true);
  await page.keyboard.type("tasks");
  await page.screenshot({ path: `${OUT}/02-command-palette.png` });
  await page.keyboard.press("Escape");

  // AI bar is honest
  await page.fill("#ai-command", "Create a quote for ABC Construction for R4,500");
  await page.getByRole("button", { name: "Send" }).click();
  // Either the honest "not connected" message or a real assistant reply — never a silent no-op.
  await page.getByRole("status").filter({ hasText: "You:" }).first().waitFor({ timeout: 20000 });
  const reply = await page.getByRole("status").filter({ hasText: "You:" }).first().innerText();
  check("AI command bar returns a real or honest-unavailable reply", /isn't available|isn't connected|customers|quote|later phase/i.test(reply));

  // Quick create → Task (live)
  await page.getByRole("button", { name: "New" }).first().click();
  await page.getByRole("menuitem", { name: "Task" }).click();
  await page.waitForURL("**/app/work/tasks?new=1");
  await page.getByRole("dialog", { name: "New task" }).waitFor();
  check("Quick Create → Task opens task form", true);
  await page.fill("#title", "Follow up ABC Construction quote");
  await page.selectOption("#priority", "high");
  const due = new Date(Date.now() + 2 * 3600e3);
  const pad = (n) => String(n).padStart(2, "0");
  await page.fill("#dueAt", `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}T${pad(due.getHours())}:${pad(due.getMinutes())}`);
  await page.getByRole("button", { name: "Create task" }).click();
  await page.getByText("Task created").waitFor();
  await page.getByText("Follow up ABC Construction quote").waitFor();
  check("task created end-to-end", true);

  // Edit
  await page.getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.fill("#title", "Follow up ABC Construction quote (called)");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Task updated").waitFor();
  check("task updated", await visible(page.getByText("(called)")));

  // Complete
  await page.getByRole("button", { name: /Mark .* complete/ }).click();
  await page.getByText("Task completed").waitFor();
  await page.goto(`${BASE}/app/work/tasks?status=completed`);
  check("completed task appears under Completed", await visible(page.getByText("(called)")));
  await page.screenshot({ path: `${OUT}/03-tasks.png`, fullPage: true });

  // Delete (owner) with confirmation
  await page.getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete task" }).click();
  await page.getByText("Task deleted").waitFor();
  check("task deleted after confirmation", true);

  // Today shows the activity trail
  await page.goto(`${BASE}/app/today`);
  check("activity shows task_completed", await visible(page.getByText(/completed task/)));
  check("activity shows task_deleted", await visible(page.getByText(/deleted task/)));

  // Settings: organisation + profile
  await page.goto(`${BASE}/app/settings/organisation`);
  await page.fill("#vatNumber", "4123456789");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Organisation saved").waitFor();
  check("organisation settings save", true);
  await page.goto(`${BASE}/app/settings/profile`);
  await page.fill("#phone", "+27 82 000 0000");
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByText("Profile saved").waitFor();
  check("profile saves", true);
  await page.goto(`${BASE}/app/settings/members`);
  check("members list shows owner", await visible(page.getByRole("cell", { name: "Owner" })));

  // Future module is honest
  await page.goto(`${BASE}/app/new/invoice`);
  check("unimplemented quick-create shows honest placeholder", await visible(page.getByText("Nothing has been created")));

  // Mobile shell
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.context().addCookies(await page.context().cookies());
  await m.goto(`${BASE}/app/today`);
  const bottomNav = m.getByRole("navigation", { name: "Main" });
  check("mobile bottom navigation visible", await visible(bottomNav));
  await m.screenshot({ path: `${OUT}/04-today-mobile.png`, fullPage: true });
  await m.getByRole("button", { name: "Quick actions" }).click();
  // Phase 003 renamed the quick actions ("Take receipt photo" → "Receipt photo", still marked "soon").
  await m.getByRole("button", { name: /Receipt photo\s*soon/ }).waitFor();
  check("mobile + opens quick action sheet", true);
  await m.screenshot({ path: `${OUT}/05-mobile-quick-actions.png` });

  check("no uncaught page errors", errors.length === 0);
  if (errors.length) console.error(errors);
} catch (e) {
  console.error("E2E aborted:", e.message);
  results.push(["completed without exception", false]);
} finally {
  await browser.close();
}
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
