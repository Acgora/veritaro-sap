/**
 * Natural-language command entry point (AI bar, ⌘K "Ask", future WhatsApp).
 *
 * Phase 001: NO language model is connected. We do not fake understanding or
 * answers. The service reports that the assistant is unavailable. When a model
 * provider is added (server-only API key), it will:
 *   text → model (with AI_TOOLS schemas) → tool call → executeTool() → response
 */
export type CommandResponse =
  | { status: "unavailable"; message: string }
  | { status: "answer"; message: string };

export function isAssistantConfigured(): boolean {
  return false; // flips when a server-side model provider is configured in a future phase
}

export async function handleCommand(text: string): Promise<CommandResponse> {
  const trimmed = text.trim();
  if (!trimmed) return { status: "unavailable", message: "Type a question or instruction." };
  return {
    status: "unavailable",
    message:
      "The assistant isn't connected yet. Your message wasn't processed. You can use Quick Create (+ New) or the menus in the meantime.",
  };
}
