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

function decide(body) {
  const items = body.input ?? [];
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
