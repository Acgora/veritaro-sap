/**
 * Provider-neutral AI types. Application code depends ONLY on these — never on a vendor SDK.
 */
export type ModelTier = "primary" | "fallback" | "premium";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export interface ChatMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the tool input. */
  inputSchema: Record<string, unknown>;
}

export interface ProviderRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface ProviderResponse {
  content: ContentBlock[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "other";
  usage: { inputTokens: number; outputTokens: number };
}

export type ProviderErrorKind = "unavailable" | "timeout" | "auth" | "bad_request" | "rate_limited";

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface AIProvider {
  readonly name: string;
  complete(req: ProviderRequest): Promise<ProviderResponse>;
}
