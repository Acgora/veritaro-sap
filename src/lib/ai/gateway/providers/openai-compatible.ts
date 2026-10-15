import "server-only";
import { ProviderError, type AIProvider, type ContentBlock, type ProviderRequest, type ProviderResponse } from "../types";
import { providerErrorFor } from "./openai";

/**
 * GENERIC OpenAI-COMPATIBLE adapter (Chat Completions, POST {base}/v1/chat/completions).
 *
 * Purpose: future self-hosted / open-weight models (Llama, Qwen, Mistral …) served by vLLM,
 * TGI, Ollama or llama.cpp, which expose this API shape. Currently used by the "selfhosted"
 * allowlist entry, which is DISABLED with no approved models.
 *
 * The endpoint comes from a server env var named in the allowlist — never from the database.
 * Not used for OpenAI itself: GPT-6 models need the Responses API for tools (see openai.ts).
 */
export class OpenAICompatibleProvider implements AIProvider {
  constructor(
    readonly name: string,
    private readonly apiKey: string,
    private readonly baseUrl: string,
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
          ...(req.tools.length
            ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })) }
            : {}),
          ...(req.responseFormat
            ? { response_format: { type: "json_schema", json_schema: { name: req.responseFormat.name, schema: req.responseFormat.schema } } }
            : {}),
        }),
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new ProviderError("timeout", "AI provider timed out");
      throw new ProviderError("unavailable", "AI provider unreachable");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw providerErrorFor(res.status);
    const body = (await res.json()) as {
      choices?: Array<{ finish_reason?: string; message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
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
      usage: {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
        cachedInputTokens: body.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
    };
  }
}
