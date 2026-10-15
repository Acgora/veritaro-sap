import "server-only";
import { ProviderError, type AIProvider, type ChatMessage, type ContentBlock, type ProviderRequest, type ProviderResponse } from "../types";

const DEFAULT_BASE_URL = "https://api.anthropic.com";

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

function toAnthropic(messages: ChatMessage[]) {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((b): AnthropicBlock => {
      if (b.type === "tool_result") return { type: "tool_result", tool_use_id: b.toolUseId, content: b.content, is_error: b.isError };
      return b;
    }),
  }));
}

export function parseAnthropicResponse(json: unknown): ProviderResponse {
  const body = json as {
    content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const content: ContentBlock[] = [];
  for (const b of body.content ?? []) {
    if (b.type === "text" && typeof b.text === "string") content.push({ type: "text", text: b.text });
    else if (b.type === "tool_use" && b.id && b.name) content.push({ type: "tool_use", id: b.id, name: b.name, input: b.input ?? {} });
  }
  const stop = body.stop_reason;
  return {
    content,
    stopReason: stop === "end_turn" || stop === "tool_use" || stop === "max_tokens" ? stop : "other",
    usage: { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 },
  };
}

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, "")}/v1/messages`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: req.model,
          system: req.system,
          max_tokens: req.maxOutputTokens,
          temperature: 0,
          messages: toAnthropic(req.messages),
          tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
        }),
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new ProviderError("timeout", "AI provider timed out");
      throw new ProviderError("unavailable", "AI provider unreachable");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      // Never surface provider bodies to users; they may echo input.
      const kind = res.status === 401 || res.status === 403 ? "auth" : res.status === 429 ? "rate_limited" : res.status >= 500 || res.status === 529 ? "unavailable" : "bad_request";
      throw new ProviderError(kind, `AI provider returned ${res.status}`, res.status);
    }
    return parseAnthropicResponse(await res.json());
  }
}
