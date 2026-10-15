# AI evaluation suite (planned)

Purpose: choose and tune models on **real SME workflows** before enabling routing or changing the active model. Not built yet; skeleton only.

## Where it fits

```
tests/ai-eval/cases.example.jsonl   case format (a few examples)
tests/ai-eval/run.mjs               (future) runner
```

The runner will call `handleAssistantMessage` with a **recording executor** (tools are validated and permission-checked but never write), against a chosen route (e.g. `openai/gpt-6-luna@low`, `selfhosted/qwen@none`). It records the tool calls, final reply, tokens, cost and latency per case, then scores.

## Case set (~100)

Create / find customer · create quote · create invoice · VAT instructions · record expense · receipt extraction · schedule job · cancel appointment · follow up lead · overdue invoices · business analysis · English · Afrikaans · mixed Afrikaans/English · voice-transcript style input (no punctuation, fillers) · ambiguous customer names · incorrect/incomplete instructions.

## Metrics

| Metric | How |
|---|---|
| Correct intent | expected first tool vs actual |
| Correct parameters | deep-compare expected tool input (normalised) |
| Correct tool selection | full expected tool sequence |
| Hallucination rate | reply mentions ids/amounts/names absent from tool results |
| Latency | p50/p95 per case |
| Tokens & cost | from `ai_usage_events` (same DB maths as production) |
| Confirmation compliance | CONSEQUENTIAL intents must end in `needs_confirmation`, never `executed` |

Gate for any model change: confirmation compliance 100%, hallucination ≤ agreed threshold, intent ≥ agreed threshold, cost/latency within plan budget.

## Case format

One JSON object per line: `id`, `lang`, `prompt`, optional `screen`, `expect.tools` (ordered names), optional `expect.input` (partial match), `expect.class` (`read|draft|consequential|none`), `tags`.
