// Phase 003 browser golden path: lead → customer → quote → job → invoice → payment, field agent view,
// AI command bar lifecycle (against a LOCAL stack with the deterministic mock provider — NOT a real model).
// Usage: E2E_BASE_URL=http://localhost:3100 E2E_EMAIL=... E2E_PASSWORD=... PW_CHROMIUM=/opt/pw-browsers/chromium node tests/e2e/phase3.mjs
// Env: E2E_OUT (screenshots, default test-results/e2e3), E2E_PSQL (default "psql -h /tmp -p 54329 -U postgres -d veritaro_e2e").
// Expects: email auto-confirm; AI_PROVIDER_OPENAI_BASE_URL → tests/e2e/mock-openai.mjs; direct psql access to the local DB.
// Not covered locally: job photo upload (no Storage API in the local stand-in).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OUT = process.env.E2E_OUT ?? "test-results/e2e3";
const EMAIL = process.env.E2E_EMAIL ?? `owner${Date.now()}@example.com`;
const PASSWORD = process.env.E2E_PASSWORD ?? "Passw0rd!2026";
const AGENT_EMAIL = EMAIL.replace("@", `+agent${Date.now()}@`);
const PSQL = (process.env.E2E_PSQL ?? "psql -h /tmp -p 54329 -U postgres -d veritaro_e2e").split(" ");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium" });
const results = [];
const check = (n, c, detail) => {
  results.push([n, !!c]);
  console.log(c ? "✔" : "✘", n);
  if (!c && detail !== undefined) console.log(`    got: ${String(detail).slice(0, 400)}`);
  return !!c;
};
const visible = (locator, timeout = 10000) => locator.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);
/** Collapse every kind of whitespace (en-ZA money uses non-breaking spaces). */
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const has = async (locator, text) => norm(await locator.innerText()).includes(text);
const sql = (q) => {
  const r = spawnSync(PSQL[0], [...PSQL.slice(1), "-tAX", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql: ${r.stderr}`);
  return r.stdout.trim();
};
const shot = (p, name, full = true) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full }).catch(() => {});
const idFrom = (url, re) => url.match(re)?.[1];
const UUID = "([0-9a-f-]{36})";
/** Run a section; on exception record a failure and continue with the next section. */
async function section(name, fn) {
  console.log(`\n— ${name}`);
  try { await fn(); } catch (e) {
    console.error(`  ${name} aborted: ${e.message.split("\n")[0]}`);
    results.push([`${name}: completed without exception`, false]);
    const slug = name.split(".")[0];
    await shot(page, `fail-${slug}-owner`);
    if (agent) await shot(agent, `fail-${slug}-agent`);
  }
}
async function noHorizontalScroll(p) {
  return p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}
async function register(p, firstName, email) {
  await p.goto(`${BASE}/register`);
  await p.fill("#firstName", firstName);
  await p.fill("#email", email);
  await p.fill("#password", PASSWORD);
  await p.click("button[type=submit]");
  await p.waitForURL("**/onboarding", { timeout: 30000 });
}
async function pdfOk(p, url) {
  const r = await p.request.get(`${BASE}${url}`);
  const body = await r.body();
  return r.ok() && (r.headers()["content-type"] ?? "").startsWith("application/pdf") && body.subarray(0, 4).toString() === "%PDF";
}
const toastShown = (p, text) => visible(p.locator("[data-sonner-toast]").filter({ hasText: text }), 15000);

const state = {};
const OWNER = "Marlize";
const AGENT = "Sipho";
const pageErrors = [];

const ownerCtx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ownerCtx.newPage();
page.on("pageerror", (e) => pageErrors.push(`owner: ${e.message}`));
let agentCtx, agent;

try {
  // -------------------------------------------------------------------------------------------
  await section("1. Register, onboard, quote & invoice settings", async () => {
    await register(page, OWNER, EMAIL);
    await page.fill("#name", "Ossewa Test Pest Control");
    await page.click("button[type=submit]");
    await page.waitForURL("**/app/today");
    check("owner registered and onboarded", true);
    state.ownerId = sql(`select id from auth.users where email = '${EMAIL}'`);
    state.orgId = sql(`select organisation_id from organisation_members where user_id = '${state.ownerId}'`);
    state.tz = sql(`select timezone from organisations where id = '${state.orgId}'`);
    state.today = new Intl.DateTimeFormat("en-CA", { timeZone: state.tz }).format(new Date());
    state.tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: state.tz }).format(new Date(Date.now() + 86400e3));

    // A tax invoice must show the seller's VAT number (Organisation settings).
    await page.goto(`${BASE}/app/settings/organisation`);
    await page.fill("#vatNumber", "4123456789");
    await page.getByRole("button", { name: "Save changes" }).click();
    check("organisation VAT number saved", await toastShown(page, "Organisation saved"));

    await page.goto(`${BASE}/app/settings/financial`);
    await page.getByLabel("My business is VAT registered").check();
    await page.fill("#taxRate", "15");
    check("prices-include-VAT default is off", !(await page.getByLabel("Prices I type already include VAT").isChecked()));
    await page.fill("#addressLine1", "1 Bird Street");
    await page.fill("#city", "Stellenbosch");
    await page.fill("#bankName", "FNB");
    await page.fill("#bankAccountHolder", "Ossewa Test Pest Control");
    await page.fill("#bankAccountNumber", "62000000001");
    await page.fill("#bankBranchCode", "250655");
    await page.getByRole("button", { name: "Save settings" }).click();
    check("financial settings saved", await toastShown(page, "Settings saved"));
    const fs = sql(`select vat_registered, tax_rate, bank_name, bank_account_number from organisation_financial_settings where organisation_id = '${state.orgId}'`);
    check("VAT 15% and bank details persisted", fs === "t|15.000|FNB|62000000001" || /^t\|15(\.0+)?\|FNB\|62000000001$/.test(fs));
    await shot(page, "p3-01-financial-settings");
  });

  // -------------------------------------------------------------------------------------------
  await section("2. Leads: create, pipeline move, call note, convert", async () => {
    await page.goto(`${BASE}/app/sales/leads`);
    await page.getByRole("button", { name: "New lead" }).first().click();
    const dlg = page.getByRole("dialog", { name: "New lead" });
    await dlg.waitFor();
    await dlg.locator("#personName").fill("DJ");
    await dlg.locator("#companyName").fill("DJ Ossewa");
    await dlg.locator("#leadPhone").fill("082 555 7788");
    await dlg.locator("#serviceSummary").fill("Pest control");
    await dlg.getByText("Site, date, value and notes").click();
    await dlg.locator("#siteAddressText").fill("12 Dorp Street, Stellenbosch");
    await dlg.getByRole("button", { name: "Add lead" }).click();
    await page.waitForURL(new RegExp(`/app/sales/leads/${UUID}$`));
    state.leadId = idFrom(page.url(), new RegExp(`/leads/${UUID}`));
    check("lead created and detail opened", !!state.leadId);

    await page.goto(`${BASE}/app/sales/leads`);
    const colNew = page.locator('section[aria-labelledby="col-new"]');
    check("lead appears in the New column of the pipeline board", await visible(colNew.getByRole("link", { name: "DJ Ossewa" })));
    await shot(page, "p3-02-leads-board");
    await page.getByRole("button", { name: "Move DJ Ossewa to another stage" }).click();
    await page.getByRole("menuitem", { name: "Contacted" }).click();
    check("Move-to menu shows a toast", await toastShown(page, "DJ Ossewa moved to Contacted"));
    await page.reload();
    check("lead now in the Contacted column", await visible(page.locator('section[aria-labelledby="col-contacted"]').getByRole("link", { name: "DJ Ossewa" })));
    check("lead status persisted", sql(`select status from leads where id = '${state.leadId}'`) === "contacted");

    await page.locator('section[aria-labelledby="col-contacted"]').getByRole("link", { name: "DJ Ossewa" }).click();
    await page.waitForURL(`**/app/sales/leads/${state.leadId}`);
    check("lead detail opens from the board", await visible(page.getByRole("heading", { name: "DJ Ossewa" })));

    await page.goto(`${BASE}/app/sales/leads/${state.leadId}?tab=communication`);
    await page.fill("#lead-log-body", "Called. Wants quote tomorrow.");
    await page.getByRole("button", { name: "Log call" }).click();
    check("call logged", await toastShown(page, "Call logged"));
    check("call note visible in Communication", await visible(page.getByRole("region", { name: "Communication history" }).getByText("Called. Wants quote tomorrow.")));

    await page.goto(`${BASE}/app/sales/leads/${state.leadId}`);
    await page.getByRole("button", { name: "Create customer" }).click();
    const conv = page.getByRole("dialog", { name: "Create customer" });
    await conv.waitFor();
    await conv.getByRole("button", { name: "Create customer" }).click();
    // Duplicate detection may intervene (e.g. a re-run); create anyway — this org is brand new.
    const dup = conv.getByRole("button", { name: /Create a new customer anyway/ });
    if (await visible(dup, 3000)) await dup.click();
    check("lead converted to a customer", await toastShown(page, "Customer created from this lead"));
    await page.reload();
    check("lead shows 'Open customer'", await visible(page.getByRole("link", { name: "Open customer" })));
    state.customerId = sql(`select customer_id from leads where id = '${state.leadId}'`);
    check("customer linked to lead in DB", /^[0-9a-f-]{36}$/.test(state.customerId));
    check("customer has the lead's site", Number(sql(`select count(*) from customer_addresses where customer_id = '${state.customerId}'`)) >= 1);
    await shot(page, "p3-03-lead-converted");
  });

  // -------------------------------------------------------------------------------------------
  await section("3. Quote: lines, VAT totals, PDF, issue, accept", async () => {
    await page.getByRole("link", { name: "Create quote" }).first().click();
    await page.waitForURL("**/app/sales/quotes/new?**");
    check("new quote form preselects the lead's customer", (await page.locator("#party-customer").inputValue()) === state.customerId);
    await page.getByRole("button", { name: "Create draft quote" }).click();
    await page.waitForURL(new RegExp(`/app/sales/quotes/${UUID}$`));
    state.quoteId = idFrom(page.url(), new RegExp(`/quotes/${UUID}`));
    check("draft quote created", !!state.quoteId);

    check("prices excl. VAT by default", !(await page.getByLabel("Prices I enter include VAT").isChecked()));
    await page.locator('input[id^="d-"]').nth(0).fill("Pest control");
    await page.locator('input[id^="p-"]').nth(0).fill("1250");
    await page.getByRole("button", { name: "Add line" }).click();
    await page.locator('input[id^="d-"]').nth(1).fill("Call-out fee");
    await page.locator('input[id^="p-"]').nth(1).fill("650");
    const live = page.locator('dl[aria-live="polite"]');
    const liveText = norm(await live.innerText());
    check("live subtotal R 1 900,00", liveText.includes("Subtotal (excl. VAT) R 1 900,00"));
    check("live VAT R 285,00", liveText.includes("VAT @ 15% R 285,00"));
    check("live total R 2 185,00", liveText.includes("Total R 2 185,00"));
    check("Send through connected channel is disabled (draft)", await page.getByRole("button", { name: "Send through connected channel" }).isDisabled());
    check("draft says no channel connected", await visible(page.getByText("No channel connected yet")));
    await page.getByRole("button", { name: "Save draft" }).click();
    check("draft saved", await toastShown(page, "Draft saved"));
    check("header shows saved total from the DB", await visible(page.getByText(/saved total R\s2\s185,00/)));
    check("DB totals 1900 / 285 / 2185", sql(`select subtotal||'|'||tax_total||'|'||total from quotes where id = '${state.quoteId}'`) === "1900.00|285.00|2185.00");
    await shot(page, "p3-04-quote-builder");
    check("quote PDF downloads (application/pdf, %PDF)", await pdfOk(page, `/api/documents/quotes/${state.quoteId}/pdf?download=1`));

    await page.getByRole("button", { name: "Mark as sent" }).click();
    const issueDlg = page.getByRole("alertdialog", { name: "Mark this quote as sent?" });
    await issueDlg.waitFor();
    check("issuing asks for confirmation; still draft before confirming", sql(`select status from quotes where id = '${state.quoteId}'`) === "draft");
    await issueDlg.getByRole("button", { name: "Issue quote" }).click();
    check("quote issued", await toastShown(page, "issued"));
    await page.getByRole("button", { name: "Mark accepted" }).waitFor({ timeout: 15000 });
    check("quote status sent with number", /^sent\|Q-\d{4}$/.test(sql(`select status||'|'||quote_number from quotes where id = '${state.quoteId}'`)));
    state.quoteNumber = sql(`select quote_number from quotes where id = '${state.quoteId}'`);
    check("issued quote view shows totals", await has(page.locator("main"), "Total R 2 185,00"));
    check("Send through connected channel disabled on issued quote", await page.getByRole("button", { name: "Send through connected channel" }).isDisabled());
    check("issued quote PDF renders", await pdfOk(page, `/api/documents/quotes/${state.quoteId}/pdf`));

    await page.getByRole("button", { name: "Mark accepted" }).click();
    const acc = page.getByRole("alertdialog", { name: /Mark quote Q-\d+ as accepted\?/ });
    await acc.waitFor();
    await acc.getByRole("button", { name: "Mark accepted" }).click();
    check("quote accepted", await toastShown(page, "Quote marked accepted"));
    check("accepted banner offers Create job", await visible(page.getByRole("link", { name: "Create job" })));
    check("quote accepted in DB", sql(`select status from quotes where id = '${state.quoteId}'`) === "accepted");
    await shot(page, "p3-05-quote-accepted");
  });

  // -------------------------------------------------------------------------------------------
  await section("4. Job from quote, assign, field agent, start, complete, calendar", async () => {
    await page.goto(`${BASE}/app/work/jobs/new?quote=${state.quoteId}`);
    check("job-from-quote shows scope", await visible(page.getByRole("region", { name: "Quote summary" }).getByText("Call-out fee")));
    check("job-from-quote shows no prices", !/R\s?\d/.test(norm(await page.getByRole("region", { name: "Quote summary" }).innerText())));
    await page.getByLabel("Schedule it now").check();
    await page.fill("#fq-date", state.today);
    await page.fill("#fq-start", "09:00");
    await page.fill("#fq-end", "11:00");
    await page.getByRole("button", { name: "Create job" }).click();
    await page.waitForURL(new RegExp(`/app/work/jobs/${UUID}`), { timeout: 20000 });
    state.jobId = idFrom(page.url(), new RegExp(`/jobs/${UUID}`));
    check("job created from the accepted quote", !!state.jobId);
    state.jobTitle = sql(`select title from jobs where id = '${state.jobId}'`);
    const cs = page.getByRole("region", { name: "Customer and site" });
    check("job shows customer", await has(cs, "DJ Ossewa"));
    check("job shows site", await has(cs, "Stellenbosch"));
    check("job shows scope from quote lines", await has(page.getByRole("region", { name: "Job details" }), "Pest control"));
    check("job shows Navigate and Call", await visible(cs.getByRole("link", { name: "Navigate" })) && await visible(cs.getByRole("link", { name: "Call" })));

    // Second user → field agent in the owner's organisation (membership added directly in the DB).
    agentCtx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    agent = await agentCtx.newPage();
    agent.on("pageerror", (e) => pageErrors.push(`agent: ${e.message}`));
    await register(agent, AGENT, AGENT_EMAIL);
    state.agentId = sql(`select id from auth.users where email = '${AGENT_EMAIL}'`);
    sql(`insert into organisation_members (organisation_id, user_id, role) values ('${state.orgId}', '${state.agentId}', 'field_agent')`);
    check("field agent added to the organisation", sql(`select role from organisation_members where user_id = '${state.agentId}'`) === "field_agent");

    await page.reload();
    await page.getByRole("button", { name: "Assign team" }).first().click();
    const asg = page.getByRole("dialog", { name: "Assign team" });
    await asg.waitFor();
    await asg.locator("label", { hasText: OWNER }).locator("input").check();
    await asg.locator("label", { hasText: AGENT }).locator("input").check();
    await asg.getByRole("button", { name: "Assign", exact: true }).click();
    check("owner + field agent assigned", await toastShown(page, "2 people assigned"));
    check("2 assignments in DB", sql(`select count(*) from job_assignments where job_id = '${state.jobId}'`) === "2");

    // Field agent's view
    await agent.goto(`${BASE}/app/today`);
    const myJobs = agent.getByRole("region", { name: "Your jobs today" });
    check("field agent Today lists the job", await visible(myJobs.getByText(state.jobTitle)) || await visible(agent.getByText(state.jobTitle)));
    await shot(agent, "p3-06-agent-today");
    await agent.goto(`${BASE}/app/work/jobs/${state.jobId}`);
    await agent.getByRole("heading", { name: state.jobTitle }).waitFor();
    const main = agent.locator("main");
    const fieldText = norm(await main.innerText());
    check("field view: customer name", fieldText.includes("DJ Ossewa"));
    check("field view: site address", fieldText.includes("Stellenbosch"));
    check("field view: Navigate", await visible(agent.getByRole("link", { name: "Navigate" })));
    check("field view: Call", await visible(agent.getByRole("link", { name: /^Call/ })));
    check("field view: scope", fieldText.includes("What to do") && fieldText.includes("Pest control"));
    check("field view: Start and Complete buttons", await visible(agent.getByRole("button", { name: "Start job" })) && await visible(agent.getByRole("button", { name: "Complete job" })));
    check("field view: no amounts", !/R\s?\d/.test(fieldText));
    check("field view: no quote/invoice links", (await agent.locator('main a[href*="/app/money"], main a[href*="/app/sales"], main a[href*="/api/documents"]').count()) === 0);
    await shot(agent, "p3-07-agent-job");
    await agent.getByRole("button", { name: "Start job" }).click();
    const startDlg = agent.getByRole("alertdialog", { name: "Start this job?" });
    await startDlg.waitFor();
    check("start asks for confirmation; job unchanged before confirming", sql(`select status from jobs where id = '${state.jobId}'`) === "scheduled");
    await startDlg.getByRole("button", { name: "Start job" }).click();
    check("field agent started the job", await toastShown(agent, "Job started"));
    check("job in progress in DB", sql(`select status from jobs where id = '${state.jobId}'`) === "in_progress");

    await agent.goto(`${BASE}/app/money/invoices`);
    check("field agent: invoices area shows no access", await visible(agent.getByText("You don't have access to this area")));
    await agent.goto(`${BASE}/app/sales/customers`);
    check("field agent: customers area shows no access", await visible(agent.getByText("You don't have access to this area")));

    // Owner completes.
    await page.reload();
    await page.getByRole("button", { name: "Complete job" }).click();
    const done = page.getByRole("alertdialog", { name: "Complete this job?" });
    await done.waitFor();
    check("complete asks for confirmation; job unchanged before confirming", sql(`select status from jobs where id = '${state.jobId}'`) === "in_progress");
    await done.locator("#status-notes").fill("All rooms treated.");
    await done.getByRole("button", { name: "Complete job" }).click();
    check("job completed", await toastShown(page, "Job completed"));
    check("job completed in DB", sql(`select status from jobs where id = '${state.jobId}'`) === "completed");
    await shot(page, "p3-08-job-completed");

    await page.goto(`${BASE}/app/work/calendar?view=day&date=${state.today}`);
    check("calendar day view shows the job", await visible(page.getByText(state.jobTitle)));
    await shot(page, "p3-09-calendar-day");
  });

  // -------------------------------------------------------------------------------------------
  await section("5. Invoice from job, issue, PDF, payments", async () => {
    await page.goto(`${BASE}/app/work/jobs/${state.jobId}`);
    await page.getByRole("button", { name: "Create invoice" }).click();
    const ci = page.getByRole("alertdialog", { name: "Create an invoice for this job?" });
    await ci.waitFor();
    await ci.getByRole("button", { name: "Create invoice" }).click();
    await page.waitForURL(new RegExp(`/app/money/invoices/${UUID}`), { timeout: 20000 });
    state.invoiceId = idFrom(page.url(), new RegExp(`/invoices/${UUID}`));
    check("draft invoice created from the job", !!state.invoiceId);
    await page.getByRole("heading", { name: "Draft invoice" }).waitFor();
    const descs = await page.locator('input[id^="d-"]').evaluateAll((els) => els.map((e) => e.value));
    check("invoice lines copied from the quote", JSON.stringify(descs) === JSON.stringify(["Pest control", "Call-out fee"]));
    check("draft invoice total R 2 185,00", await visible(page.getByText(/saved total R\s2\s185,00/)));
    check("draft invoice has no number yet", sql(`select coalesce(invoice_number,'none') from invoices where id = '${state.invoiceId}'`) === "none");
    await shot(page, "p3-10-invoice-draft");

    await page.getByRole("button", { name: "Issue invoice" }).click();
    const iss = page.getByRole("alertdialog", { name: "Issue this invoice?" });
    await iss.waitFor();
    check("issue asks for confirmation; still draft before confirming", sql(`select status from invoices where id = '${state.invoiceId}'`) === "draft");
    await iss.getByRole("button", { name: "Issue invoice" }).click();
    check("invoice issued as INV-0001", await visible(page.getByRole("heading", { name: "Tax invoice INV-0001" }), 15000));
    check("invoice DB: issued, INV-0001, 2185", sql(`select status||'|'||invoice_number||'|'||total from invoices where id = '${state.invoiceId}'`) === "issued|INV-0001|2185.00");
    check("bank details snapshotted on the invoice", /FNB/.test(sql(`select row_to_json(i)::text from invoices i where id = '${state.invoiceId}'`)));
    check("invoice PDF downloads (application/pdf, %PDF)", await pdfOk(page, `/api/documents/invoices/${state.invoiceId}/pdf?download=1`));
    check("Send through connected channel not offered as working", (await page.getByRole("button", { name: "Send through connected channel" }).count()) === 0
      || await page.getByRole("button", { name: "Send through connected channel" }).isDisabled());

    // Part payment, with a double click on the final button (double-submit protection).
    await page.getByRole("button", { name: "Record payment" }).click();
    let pay = page.getByRole("dialog", { name: "Record a payment" });
    await pay.waitFor();
    await pay.locator("#pay-amount").fill("1000");
    await pay.getByRole("button", { name: "Review payment" }).click();
    check("payment review states the remaining amount", await visible(pay.getByText(/R\s1\s185,00 will still be due/)));
    check("nothing recorded before confirming", sql(`select count(*) from payments where invoice_id = '${state.invoiceId}'`) === "0");
    await pay.getByRole("button", { name: "Record payment" }).dblclick();
    check("payment recorded", await toastShown(page, "Payment recorded"));
    await page.waitForTimeout(1500);
    check("double submission created exactly ONE payment row", sql(`select count(*) from payments where invoice_id = '${state.invoiceId}'`) === "1");
    await page.reload();
    check("status Part paid", await visible(page.getByText("Part paid")));
    check("amount due R 1 185,00", await has(page.locator("main"), "Amount due R 1 185,00"));
    check("invoice DB partially_paid, due 1185", sql(`select status||'|'||amount_due from invoices where id = '${state.invoiceId}'`) === "partially_paid|1185.00");
    await shot(page, "p3-11-invoice-part-paid");

    await page.getByRole("button", { name: "Record payment" }).click();
    pay = page.getByRole("dialog", { name: "Record a payment" });
    await pay.waitFor();
    check("second payment defaults to the amount due", (await pay.locator("#pay-amount").inputValue()) === "1185.00");
    await pay.getByRole("button", { name: "Review payment" }).click();
    check("review says fully paid", await visible(pay.getByText(/The invoice will be fully paid/)));
    await pay.getByRole("button", { name: "Record payment" }).click();
    check("final payment recorded", await toastShown(page, "Payment recorded"));
    await page.reload();
    check("status Paid", await visible(page.locator("main").getByText("Paid", { exact: true })));
    check("amount due R 0,00", await has(page.locator("main"), "Amount due R 0,00"));
    check("invoice DB paid, due 0, 2 payments", sql(`select status||'|'||amount_due||'|'||(select count(*) from payments p where p.invoice_id = i.id) from invoices i where id = '${state.invoiceId}'`) === "paid|0.00|2");
    check("no Record payment on a paid invoice", (await page.getByRole("button", { name: "Record payment" }).count()) === 0);
    await shot(page, "p3-12-invoice-paid");
  });

  // -------------------------------------------------------------------------------------------
  await section("6. Customer lifecycle tabs, Today, global search", async () => {
    await page.goto(`${BASE}/app/sales/customers/${state.customerId}`);
    const tabs = page.getByRole("navigation", { name: /Customer sections|sections/ });
    for (const t of ["Quotes", "Jobs", "Invoices"]) check(`customer has ${t} tab`, await visible(page.getByRole("link", { name: t, exact: true })));
    const bal = page.getByRole("link", { name: "Customer balance — view invoices" });
    check("customer balance outstanding R 0,00", await visible(bal) && norm(await bal.innerText()).includes("Outstanding R 0,00"));
    await shot(page, "p3-13-customer");
    void tabs;
    await page.goto(`${BASE}/app/sales/customers/${state.customerId}?tab=quotes`);
    check("customer Quotes tab lists the quote", await visible(page.getByText(state.quoteNumber)));
    await page.goto(`${BASE}/app/sales/customers/${state.customerId}?tab=jobs`);
    check("customer Jobs tab lists the job", await visible(page.getByText(state.jobTitle)));
    await page.goto(`${BASE}/app/sales/customers/${state.customerId}?tab=invoices`);
    check("customer Invoices tab lists INV-0001", await visible(page.getByText("INV-0001")));

    await page.goto(`${BASE}/app/today`);
    const kpis = page.getByRole("list", { name: "Key numbers" });
    check("Today: money outstanding R 0,00", await visible(kpis.getByRole("link", { name: /Money outstanding\s*R\s0,00/ })));
    const attention = page.locator('section[aria-labelledby="attention-heading"]');
    await attention.waitFor();
    const att = norm(await attention.innerText());
    check("Today: nothing about this invoice in Needs attention", !/INV-0001|invoices? (is|are) overdue|due in the next/i.test(att), att);
    const activity = page.getByRole("region", { name: "Recent activity" });
    await visible(activity.getByText(/payment/i));
    const act = norm(await activity.innerText());
    check("Today activity: payment event", /payment/i.test(act));
    check("Today activity: invoice event", /invoice/i.test(act));
    await shot(page, "p3-14-today");

    await page.keyboard.press("Control+k");
    const palette = page.getByPlaceholder("Search customers, quotes, jobs, invoices or pages…");
    await palette.waitFor();
    await palette.fill("INV-0001");
    check("global search finds INV-0001", await visible(page.getByRole("option", { name: /INV-0001/ })));
    await palette.fill("DJ Ossewa");
    check("global search finds DJ Ossewa", await visible(page.getByRole("option", { name: /DJ Ossewa/ })));
    await shot(page, "p3-15-search", false);
    await page.getByRole("option", { name: /DJ Ossewa/ }).first().click();
    await page.waitForURL(/\/app\/(sales|work|money)\/\w+\/[0-9a-f-]{36}/);
    check("search result opens the record", true);
  });

  // -------------------------------------------------------------------------------------------
  await section("7. Field agent cannot see money (UI + RLS)", async () => {
    await agent.goto(`${BASE}/app/work/jobs/${state.jobId}`);
    await agent.getByRole("heading", { name: state.jobTitle }).waitFor();
    const t = norm(await agent.locator("main").innerText());
    check("completed job (field view) still shows no amounts", !/R\s?\d/.test(t));
    check("completed job (field view) has no invoice link", !/INV-0001|invoice/i.test(t));
    const rls = (table) => sql(`begin; set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub','${state.agentId}','role','authenticated')::text, true); select count(*) from ${table}; rollback;`).split("\n").filter((l) => /^\d+$/.test(l)).pop();
    check("RLS: field agent reads 0 invoices", rls("invoices") === "0");
    check("RLS: field agent reads 0 payments", rls("payments") === "0");
    check("RLS: field agent reads 0 quotes", rls("quotes") === "0");
    check("RLS: field agent reads 0 customers", rls("customers") === "0");
    check("RLS: owner reads the invoice (control)", sql(`begin; set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub','${state.ownerId}','role','authenticated')::text, true); select count(*) from invoices; rollback;`).split("\n").filter((l) => /^\d+$/.test(l)).pop() === "1");
  });

  // -------------------------------------------------------------------------------------------
  await section("8. AI command bar golden path", async () => {
    // Customer for the AI flow, created through the UI in a second tab so the AI conversation tab never reloads.
    const side = await ownerCtx.newPage();
    const createCustomer = async (name, phone) => {
      await side.goto(`${BASE}/app/sales/customers?new=1`);
      await side.fill("#displayName", name);
      await side.fill("#phone", phone);
      await side.locator("#email").focus(); // runs the (async) duplicate check
      const different = side.getByLabel("This is a different customer");
      // The similar-name warning may appear before or after the first submit; the form refuses to save until it is ticked.
      for (let attempt = 0; attempt < 3; attempt++) {
        if (await visible(different, 1500)) await different.check();
        await side.getByRole("button", { name: "Add customer" }).click();
        if (await side.waitForURL(new RegExp(`/app/sales/customers/${UUID}`), { timeout: 5000 }).then(() => true, () => false)) break;
      }
      await side.waitForURL(new RegExp(`/app/sales/customers/${UUID}`)).catch(async (e) => { await shot(side, "fail-8-side"); throw e; });
      return idFrom(side.url(), new RegExp(`/customers/${UUID}`));
    };
    state.karooId = await createCustomer("Karoo Pest Co", "021 555 0101");
    check("customer Karoo Pest Co created", !!state.karooId);

    // The default plan allows 30 model calls per user per 10 minutes; this scripted lifecycle makes ~45 in two minutes.
    // Raise the limit for this test org only (per-org override row) so the golden path isn't cut off mid-way.
    sql(`insert into ai_org_limits (organisation_id, user_rate_limit) values ('${state.orgId}', 500)
         on conflict (organisation_id) do update set user_rate_limit = 500`);
    await page.goto(`${BASE}/app/today`);
    const bar = page.locator("#ai-command");
    const reply = page.getByRole("status").filter({ hasText: "You:" });
    let lastReply = "";
    const ask = async (text, { timeout = 30000 } = {}) => {
      await bar.fill(text);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await reply.filter({ hasText: text }).first().waitFor({ timeout });
      await page.waitForFunction(() => document.querySelector("#ai-command")?.getAttribute("placeholder") !== "Working…", null, { timeout });
      lastReply = norm(await reply.first().innerText());
      return lastReply;
    };
    const confirmBox = () => page.getByRole("status").getByRole("button", { name: "Confirm", exact: true });
    const confirm = async () => {
      await confirmBox().click();
      await reply.filter({ hasText: "You: Confirm" }).first().waitFor({ timeout: 30000 });
      await page.waitForFunction(() => document.querySelector("#ai-command")?.getAttribute("placeholder") !== "Working…", null, { timeout: 30000 });
      lastReply = norm(await reply.first().innerText());
      return lastReply;
    };
    const karooQuote = () => sql(`select id||'|'||status from quotes where customer_id = '${state.karooId}' order by created_at desc limit 1`);

    let r = await ask("Add Johan from Ossewa Pest as a lead. He wants pest control in Stellenbosch.");
    check("AI: lead created", /Added lead/.test(r), r);
    check("AI: lead row exists", sql(`select count(*) from leads where organisation_id = '${state.orgId}' and person_name = 'Johan'`) === "1");
    r = await ask("Show me the leads I haven't followed up with");
    check("AI: follow-up list answers from data", /lead\(s\) need a follow-up/.test(r), r);

    r = await ask("Create a quote for Karoo Pest Co for pest control at R1,250 excluding VAT");
    check("AI: draft quote created excl. VAT (R 1 437,50)", /draft quote for Karoo Pest Co/.test(r) && r.includes("total R 1 437,50"), r);
    r = await ask("Add a R650 call-out fee to that quote");
    // get_quote/add_quote_line return subtotal & VAT as decimals and the total pre-formatted (all from the DB).
    check("AI: line added, total R 2 185,00 from the DB", /subtotal (R 1 900,00|1900\.00)/.test(r) && /VAT (R 285,00|285\.00)/.test(r) && r.includes("total R 2 185,00"), r);
    r = await ask("Show me the quote");
    check("AI: shows the quote", r.includes("total R 2 185,00"), r);
    await shot(page, "p3-16-ai-quote", false);

    r = await ask("Mark it sent");
    check("AI: mark sent asks for confirmation", /Please confirm/.test(r) && await visible(confirmBox()), r);
    check("AI: quote still draft before Confirm", karooQuote().endsWith("|draft"));
    await shot(page, "p3-17-ai-confirm", false);
    await confirm();
    check("AI: quote sent after Confirm", karooQuote().endsWith("|sent"));

    r = await ask("Mark it accepted");
    check("AI: accept asks for confirmation", /Please confirm/.test(r) && await visible(confirmBox()), r);
    check("AI: quote still sent before Confirm", karooQuote().endsWith("|sent"));
    await confirm();
    check("AI: quote accepted after Confirm", karooQuote().endsWith("|accepted"));

    r = await ask(`Create a job from it for ${state.tomorrow} at 09:00`);
    check("AI: job created and scheduled", /Job created and scheduled/.test(r), r);
    const karooJob = () => sql(`select id||'|'||status from jobs where customer_id = '${state.karooId}' order by created_at desc limit 1`);
    state.karooJob = karooJob().split("|")[0];
    r = await ask(`Assign ${OWNER} to the job`);
    check("AI: assigned by first name", /Assigned/.test(r) && sql(`select count(*) from job_assignments where job_id = '${state.karooJob}' and user_id = '${state.ownerId}'`) === "1", r);
    r = await ask(`What jobs do we have on ${state.tomorrow}?`);
    check("AI: lists jobs for the date", /1 job\(s\) on/.test(r) && /J-\d{4}/.test(r), r);

    r = await ask("Complete the job");
    check("AI: complete asks for confirmation", /Please confirm/.test(r) && await visible(confirmBox()), r);
    check("AI: job not completed before Confirm", karooJob().endsWith("|scheduled"));
    await confirm();
    check("AI: job completed after Confirm", karooJob().endsWith("|completed"));

    r = await ask("Create the invoice");
    check("AI: draft invoice created", /Draft invoice created/.test(r), r);
    const karooInv = () => sql(`select id||'|'||status||'|'||coalesce(invoice_number,'-') from invoices where customer_id = '${state.karooId}' order by created_at desc limit 1`);
    state.karooInv = karooInv().split("|")[0];
    r = await ask("Issue the invoice");
    check("AI: issue asks for confirmation", /Please confirm/.test(r) && await visible(confirmBox()), r);
    check("AI: invoice still draft before Confirm", karooInv().endsWith("|draft|-"));
    await confirm();
    check("AI: invoice issued as INV-0002 after Confirm", karooInv().endsWith("|issued|INV-0002"));

    r = await ask("Record R1,000 received against the invoice");
    check("AI: payment asks for confirmation", /Please confirm/.test(r) && await visible(confirmBox()), r);
    check("AI: no payment before Confirm", sql(`select count(*) from payments where invoice_id = '${state.karooInv}'`) === "0");
    await confirm();
    check("AI: one payment after Confirm", sql(`select count(*) from payments where invoice_id = '${state.karooInv}'`) === "1");
    r = await ask("How much does Karoo Pest Co owe me?");
    check("AI: Karoo Pest Co owes R 1 185,00", r.includes("They owe R 1 185,00"), r);
    r = await ask("Record R1,185 received against the invoice");
    check("AI: final payment asks for confirmation", /Please confirm/.test(r) && await visible(confirmBox()), r);
    check("AI: still one payment before Confirm", sql(`select count(*) from payments where invoice_id = '${state.karooInv}'`) === "1");
    await confirm();
    check("AI: invoice paid", karooInv().split("|")[1] === "paid");
    r = await ask("How much does Karoo Pest Co owe me?");
    check("AI: Karoo Pest Co owes R 0,00", r.includes("They owe R 0,00"), r);

    r = await ask("Send it to them");
    check("AI: send is honest — no channel connected", /No email or WhatsApp channel is connected/.test(r), r);
    check("AI: send shows NO confirmation box", (await confirmBox().count()) === 0);
    await shot(page, "p3-18-ai-send-honest", false);

    // Ambiguity: a second customer whose name also matches.
    state.paarlId = await createCustomer("Karoo Pest Co Paarl", "023 555 0202");
    await side.close();
    r = await ask("How much does Karoo Pest owe me?");
    check("AI: ambiguous customer → 'Which one do you mean?'", /Which one do you mean\?/.test(r) && r.includes("Karoo Pest Co Paarl"), r);
    check("AI: ambiguity shows no confirmation box", (await confirmBox().count()) === 0);
    await shot(page, "p3-19-ai-ambiguous", false);
  });

  // -------------------------------------------------------------------------------------------
  await section("9. Mobile 390×844", async () => {
    const mOwner = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mOwner.addCookies(await ownerCtx.cookies());
    const m = await mOwner.newPage();
    m.on("pageerror", (e) => pageErrors.push(`mobile: ${e.message}`));
    await m.goto(`${BASE}/app/today`);
    await m.getByRole("heading", { name: new RegExp(`Good (morning|afternoon|evening), ${OWNER}`) }).waitFor();
    await shot(m, "p3-20-mobile-today");
    check("mobile Today: no horizontal scroll", await noHorizontalScroll(m));
    await m.goto(`${BASE}/app/sales/leads`);
    check("mobile leads: stage chips shown", await visible(m.getByRole("group", { name: "Filter by stage" })));
    await m.getByRole("group", { name: "Filter by stage" }).getByRole("button", { name: /^Won/ }).click();
    check("mobile leads: won lead listed under the Won chip", await visible(m.getByRole("link", { name: "DJ Ossewa" })));
    await shot(m, "p3-21-mobile-leads");
    check("mobile leads: no horizontal scroll", await noHorizontalScroll(m));

    const mAgent = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mAgent.addCookies(await agentCtx.cookies());
    const a = await mAgent.newPage();
    await a.goto(`${BASE}/app/work/jobs/${state.jobId}`);
    await a.getByRole("heading", { name: state.jobTitle }).waitFor();
    await shot(a, "p3-22-mobile-agent-job");
    check("mobile field job: no horizontal scroll", await noHorizontalScroll(a));
    await a.goto(`${BASE}/app/today`);
    await shot(a, "p3-23-mobile-agent-today");
    check("mobile field Today: no horizontal scroll", await noHorizontalScroll(a));
    await mOwner.close();
    await mAgent.close();
  });

  if (pageErrors.length) console.error("PAGE ERRORS:", pageErrors);
  check("no uncaught page errors", pageErrors.length === 0);
} catch (e) {
  console.error("E2E aborted:", e.message);
  results.push(["completed without exception", false]);
} finally {
  await browser.close();
}
console.log("\nNot tested locally: job photo upload (no Storage API in the local stack).");
const failed = results.filter(([, ok]) => !ok);
if (failed.length) console.log(`Failed:\n${failed.map(([n]) => `  ✘ ${n}`).join("\n")}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
