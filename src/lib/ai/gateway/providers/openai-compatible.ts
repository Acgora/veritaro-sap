import "server-only";
import { ProviderError, type AIProvider, type ContentBlock, type ProviderRequest, type ProviderResponse } from "../types";

/**
 * SECOND-PROVIDER INTERFACE (approved D9: built, NOT enabled).
 * No model is on the allowlist for this provider, so the router can never select it.
 * Enabling it requires: allowlisting a model, a priced row in ai_model_prices, an env key,
 * enabling a route row — and a POPIA processor review. Customer data is never sent to a
 * second provider silently.
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly name = "openai";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = "https://api.openai.com",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    const messages: unknown[] = [{ role: "system", content: req.system }];
    for (const m of req.messages) {
      const text = m.content.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n");
      const calls = m.content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
      const results = m.content.filter((b): b is Extract<ContentBlock, { type: "tool_result" }> => b.type === "tool_result");
      if (m.role === "assistant") {
        messages.push({
          role: "assistant",
          content: text || null,
          tool_calls: calls.length ? calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } })) : undefined,
        });
      } else {
        for (const r of results) messages.push({ role: "tool", tool_call_id: r.toolUseId, content: r.content });
        if (text) messages.push({ role: "user", content: text });
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxOutputTokens,
          temperature: 0,
          messages,
          tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
        }),
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new ProviderError("timeout", "AI provider timed out");
      throw new ProviderError("unavailable", "AI provider unreachable");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new ProviderError(res.status === 429 ? "rate_limited" : res.status >= 500 ? "unavailable" : "bad_request", `AI provider returned ${res.status}`, res.status);
    const body = (await res.json()) as {
      choices?: Array<{ finish_reason?: string; message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = body.choices?.[0];
    const content: ContentBlock[] = [];
    if (choice?.message?.content) content.push({ type: "text", text: choice.message.content });
    for (const c of choice?.message?.tool_calls ?? []) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(c.function.arguments) as Record<string, unknown>;
      } catch {
        input = {};
      }
      content.push({ type: "tool_use", id: c.id, name: c.function.name, input });
    }
    return {
      content,
      stopReason: choice?.finish_reason === "tool_calls" ? "tool_use" : choice?.finish_reason === "stop" ? "end_turn" : choice?.finish_reason === "length" ? "max_tokens" : "other",
      usage: { inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 },
    };
  }
}
