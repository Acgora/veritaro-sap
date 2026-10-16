// Deterministic stand-in for the OpenAI Responses API (local E2E only — never a real model).
// Rejects requests that break our contract: wrong model, temperature sent, store not false,
// unapproved reasoning effort, or a missing/incorrect Bearer key.
// Usage: MOCK_KEY=mock-key [MOCK_DOWN=1] [MOCK_PORT=54400] node tests/e2e/mock-openai.mjs
import http from "node:http";

const KEY = process.env.MOCK_KEY ?? "mock-key";
const PORT = Number(process.env.MOCK_PORT ?? 54400);
let n = 0;
const msg = (t) => ({ type: "message", role: "assistant", content: [{ type: "output_text", text: t }] });
const call = (name, args) => ({ type: "function_call", call_id: `call_${++n}`, name, arguments: JSON.stringify(args) });

function reply(output, body) {
  return {
    id: `resp_${n}`, object: "response", status: "completed", model: body.model,
    output: [{ type: "reasoning", summary: [] }, ...output],
    usage: { input_tokens: Math.ceil(JSON.stringify(body).length / 4), input_tokens_details: { cached_tokens: 0 },
      output_tokens: 40, output_tokens_details: { reasoning_tokens: 8 } },
  };
}

// ---- Phase 003 scripted lifecycle ------------------------------------------------------
// The mock reads "Records referenced" footers from history exactly like the real model is told to,
// so context ("that quote", "the job") is exercised end to end. It does NOT test model judgement.
const allText = (items) => items.flatMap((i) => (i.content ?? []).map((c) => c.text ?? "")).join("\n");
function lastRef(items, type) {
  const re = new RegExp(`${type} "[^"]*" id=([0-9a-f-]{36})`, "g");
  let m, id = null;
  const text = allText(items);
  while ((m = re.exec(text))) id = m[1];
  return id;
}
const amountOf = (t) => (t.match(/R\s?([\d,]+(?:\.\d{1,2})?)/)?.[1] ?? "").replace(/,/g, "");

function decidePhase3(body, items, lastUserText, last) {
  const t = lastUserText;
  if (last?.type === "function_call_output") {
    const fc = items.find((i) => i.type === "function_call" && i.call_id === last.call_id);
    const tool = fc?.name;
    let data = {};
    try { data = JSON.parse(last.output); } catch {}
    if (String(last.output).startsWith("ERROR:")) return reply([msg(`That didn't work: ${last.output.slice(7)}`)], body);
    switch (tool) {
      case "create_lead": return reply([msg(`Added lead ${data.title}.`)], body);
      case "list_leads_needing_followup": return reply([msg(`${data.leads.length} lead(s) need a follow-up: ${data.leads.map((l) => l.name).join(", ") || "none"}.`)], body);
      case "search_customers": {
        const cs = data.customers ?? [];
        if (cs.length === 0) return reply([msg("I couldn't find that customer.")], body);
        if (cs.length > 1) return reply([msg(`Which one do you mean? ${cs.map((c) => `${c.name}${c.phone ? ` (${c.phone})` : ""}`).join(" or ")}`)], body);
        const c = cs[0];
        if (/quote for/i.test(t)) {
          const price = amountOf(t);
          return reply([call("create_quote_draft", { customerId: c.id, title: "Pest control", lines: [{ description: "Pest control", unitPrice: price }], pricesIncludeVat: !/excl/i.test(t) && /incl/i.test(t) })], body);
        }
        if (/owe/i.test(t)) return reply([call("get_customer_balance", { customerId: c.id })], body);
        return null;
      }
      case "create_quote_draft": case "add_quote_line": case "get_quote":
        return reply([msg(`${data.quoteNumber} is a ${data.status} quote for ${data.customer}: subtotal ${data.subtotal}, VAT ${data.vat}, total ${data.totalFormatted}.`)], body);
      case "create_job_from_quote": return reply([msg(data.created ? "Job created and scheduled." : "That quote already has a job.")], body);
      case "list_team_members": {
        const name = t.match(/assign (\w+)/i)?.[1] ?? "";
        const ms = (data.members ?? []).filter((m) => m.name.toLowerCase().includes(name.toLowerCase()));
        if (ms.length !== 1) return reply([msg(ms.length ? `Which ${name} do you mean?` : `I couldn't find ${name} in your team.`)], body);
        return reply([call("assign_job", { jobId: lastRef(items, "job"), userIds: [ms[0].userId] })], body);
      }
      case "assign_job": return reply([msg("Assigned.")], body);
      case "list_jobs_for_date": return reply([msg(`${data.jobs.length} job(s) on ${data.date}: ${data.jobs.map((j) => `${j.number} ${j.title} (${j.when})`).join(", ")}.`)], body);
      case "create_invoice_from_job": return reply([msg(data.created ? "Draft invoice created — review it before issuing." : "That job already has an invoice.")], body);
      case "get_customer_balance": return reply([msg(`They owe ${data.outstanding} (${data.openInvoices} open invoice(s)).`)], body);
      default: return null;
    }
  }
  let m;
  if ((m = t.match(/add (\w+) from (.+?) as a lead\. (?:he|she|they) wants? (.+?) in (\w+)/i)))
    return reply([call("create_lead", { personName: m[1], companyName: m[2], serviceSummary: m[3], siteAddressText: m[4], source: "phone" })], body);
  if (/leads? i haven.?t followed up/i.test(t)) return reply([call("list_leads_needing_followup", {})], body);
  if ((m = t.match(/quote for (.+?) for /i))) return reply([call("search_customers", { query: m[1] })], body);
  if ((m = t.match(/add a (R[\d,.]+) (.+?) to that quote/i)))
    return reply([call("add_quote_line", { quoteId: lastRef(items, "quote"), description: m[2].replace(/^./, (c) => c.toUpperCase()), unitPrice: amountOf(m[1]) })], body);
  if (/show me the quote/i.test(t)) return reply([call("get_quote", { quoteId: lastRef(items, "quote") })], body);
  if (/mark it sent/i.test(t)) return reply([call("mark_quote_sent", { quoteId: lastRef(items, "quote") })], body);
  if (/mark it accepted/i.test(t)) return reply([call("accept_quote", { quoteId: lastRef(items, "quote"), method: "verbal" })], body);
  if ((m = t.match(/create a job from it for (\d{4}-\d{2}-\d{2}) at (\d{2}:\d{2})/i)))
    return reply([call("create_job_from_quote", { quoteId: lastRef(items, "quote"), date: m[1], startTime: m[2], endTime: "11:00" })], body);
  if (/assign \w+ to the job/i.test(t)) return reply([call("list_team_members", {})], body);
  if ((m = t.match(/what jobs do we have on (\d{4}-\d{2}-\d{2})/i))) return reply([call("list_jobs_for_date", { date: m[1] })], body);
  if (/complete the job/i.test(t)) return reply([call("complete_job", { jobId: lastRef(items, "job") })], body);
  if (/create the invoice/i.test(t)) return reply([call("create_invoice_from_job", { jobId: lastRef(items, "job") })], body);
  if (/issue the invoice/i.test(t)) return reply([call("issue_invoice", { invoiceId: lastRef(items, "invoice") })], body);
  if ((m = t.match(/how much does (.+?) owe/i))) return reply([call("search_customers", { query: m[1] })], body);
  if (/record (R[\d,.]+) received against the invoice/i.test(t))
    return reply([call("record_payment", { invoiceId: lastRef(items, "invoice"), amount: amountOf(t) })], body);
  if (/send it to them/i.test(t)) return reply([call("send_message", { text: "Your invoice" })], body);
  return null;
}

function decide(body) {
  const items = body.input ?? [];
  {
    const lastUser = [...items].reverse().find((i) => i.role === "user")?.content?.[0]?.text ?? "";
    const p3 = decidePhase3(body, items, lastUser, items[items.length - 1]);
    if (p3) return p3;
  }
  const lastUserText = [...items].reverse().find((i) => i.role === "user")?.content?.[0]?.text ?? "";
  const last = items[items.length - 1];
  const screenId = /customerId ([0-9a-f-]{36})/.exec(body.instructions ?? "")?.[1];

  if (last?.type === "function_call_output") {
    let data = {};
    try { data = JSON.parse(last.output); } catch {}
    if (/archive/i.test(lastUserText) && Array.isArray(data.customers)) {
      const c = data.customers[0];
      if (!c) return reply([msg("I couldn't find that customer.")], body);
      return reply([call("archive_customer", { customerId: c.id })], body);
    }
    if (data.created) return reply([msg(`Added ${data.name} as a customer.`)], body);
    if (data.possibleDuplicates) return reply([msg(`That looks like an existing customer: ${data.possibleDuplicates.map((d) => d.name).join(", ")}. Is it different?`)], body);
    if (Array.isArray(data.customers)) return reply([msg(data.customers.length ? `Found: ${data.customers.map((c) => c.name).join(", ")}.` : "No customers found.")], body);
    if (data.id && data.name && Array.isArray(data.contacts)) return reply([msg(`You're looking at ${data.name}.`)], body);
    if (String(last.output).startsWith("ERROR:")) return reply([msg(`That didn't work: ${last.output}`)], body);
    return reply([msg("Done.")], body);
  }

  let m;
  if (/\b(they|them|this customer)\b/i.test(lastUserText) && screenId) return reply([call("get_customer", { customerId: screenId })], body);
  if ((m = lastUserText.match(/add (.+?) as a customer(?:, contact (\w+))?(?:, ([+\d ]+))?/i))) {
    const input = { displayName: m[1].trim() };
    if (m[2]) input.contact = { firstName: m[2], ...(m[3] ? { phone: m[3].trim() } : {}) };
    if (m[3]) input.phone = m[3].trim();
    return reply([call("create_customer", input)], body);
  }
  if ((m = lastUserText.match(/(?:find|search|archive) (.+)/i))) return reply([call("search_customers", { query: m[1].trim() })], body);
  return reply([msg("I can help with customers and tasks.")], body);
}

http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const bad = (code, why) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: why } })); };
    if (req.url !== "/v1/responses" || req.headers.authorization !== `Bearer ${KEY}`) return bad(401, "unauthorized");
    if (process.env.MOCK_DOWN === "1") return bad(503, "down");
    const body = JSON.parse(raw);
    if (body.model !== "gpt-6-luna") return bad(400, "model");
    if ("temperature" in body || "top_p" in body) return bad(400, "temperature not supported");
    if (body.store !== false) return bad(400, "store must be false");
    if (!["none", "low", "medium"].includes(body.reasoning?.effort)) return bad(400, "effort");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(decide(body)));
  });
}).listen(PORT, "127.0.0.1", () => console.log(`mock openai on ${PORT}`));
