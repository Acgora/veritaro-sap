import "server-only";
import { ProviderError, type AIProvider, type ChatMessage, type ContentBlock, type ProviderRequest, type ProviderResponse } from "../types";

/**
 * OpenAI adapter — Responses API (POST /v1/responses).
 *
 * Why Responses and not Chat Completions: GPT-6 models are reasoning models; on Chat
 * Completions, function calling only works with reasoning effort "none", and `temperature`
 * is rejected whenever effort is not "none". The Responses API supports tools at every
 * effort level. (Chat Completions stays available for self-hosted endpoints — see
 * openai-compatible.ts.)
 *
 * Data minimisation: `store: false` — OpenAI is asked not to retain the response for later
 * retrieval. We send no user identifiers.
 */
type InputItem =
  | { role: "user" | "assistant"; content: Array<{ type: "input_text" | "output_text"; text: string }> }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

export function toResponsesInput(messages: ChatMessage[]): InputItem[] {
  const items: InputItem[] = [];
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === "text") {
        if (!b.text) continue;
        items.push({ role: m.role, content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text: b.text }] });
      } else if (b.type === "tool_use") {
        // No item `id` is sent: with store:false the provider has no server-side copy to link to.
        items.push({ type: "function_call", call_id: b.id, name: b.name, arguments: JSON.stringify(b.input) });
      } else {
        items.push({ type: "function_call_output", call_id: b.toolUseId, output: b.isError ? `ERROR: ${b.content}` : b.content });
      }
    }
  }
  return items;
}

export function buildResponsesBody(req: ProviderRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    instructions: req.system,
    input: toResponsesInput(req.messages),
    max_output_tokens: req.maxOutputTokens,
    store: false,
    // Deliberately NO temperature/top_p: rejected by reasoning models.
  };
  if (req.reasoningEffort) body.reasoning = { effort: req.reasoningEffort };
  if (req.tools.length) {
    body.tools = req.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.inputSchema, strict: false }));
    body.parallel_tool_calls = true;
  }
  if (req.responseFormat) {
    body.text = { format: { type: "json_schema", name: req.responseFormat.name, schema: req.responseFormat.schema, strict: false } };
    // strict:false — callers validate with zod anyway; avoids rejecting schemas with optional fields.
  }
  return body;
}

interface ResponsesBody {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{
    type: string;
    role?: string;
    content?: Array<{ type: string; text?: string; refusal?: string }>;
    call_id?: string;
    name?: string;
    arguments?: string;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
}

export function parseResponsesResponse(json: unknown): ProviderResponse {
  const body = json as ResponsesBody;
  const content: ContentBlock[] = [];
  for (const item of body.output ?? []) {
    if (item.type === "message") {
      const text = (item.content ?? [])
        .map((c) => (c.type === "output_text" ? c.text ?? "" : c.type === "refusal" ? c.refusal ?? "" : ""))
        .join("")
        .trim();
      if (text) content.push({ type: "text", text });
    } else if (item.type === "function_call" && item.call_id && item.name) {
      let input: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(item.arguments || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
      } catch {
        input = {}; // malformed arguments → the tool's zod validation rejects it
      }
      content.push({ type: "tool_use", id: item.call_id, name: item.name, input });
    }
    // "reasoning" items are ignored (never shown, never stored).
  }
  const hasTool = content.some((b) => b.type === "tool_use");
  const stopReason: ProviderResponse["stopReason"] =
    body.status === "incomplete" && body.incomplete_details?.reason === "max_output_tokens"
      ? "max_tokens"
      : hasTool
        ? "tool_use"
        : body.status === "completed"
          ? "end_turn"
          : "other";
  const u = body.usage ?? {};
  return {
    content,
    stopReason,
    usage: {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cachedInputTokens: u.input_tokens_details?.cached_tokens ?? 0,
      reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? 0,
    },
  };
}

export function providerErrorFor(status: number): ProviderError {
  const kind = status === 401 || status === 403 ? "auth" : status === 429 ? "rate_limited" : status >= 500 ? "unavailable" : "bad_request";
  // Never surface provider bodies to users; they may echo input.
  return new ProviderError(kind, `AI provider returned ${status}`, status);
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = "https://api.openai.com",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, "")}/v1/responses`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(buildResponsesBody(req)),
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new ProviderError("timeout", "AI provider timed out");
      throw new ProviderError("unavailable", "AI provider unreachable");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw providerErrorFor(res.status);
    return parseResponsesResponse(await res.json());
  }
}
