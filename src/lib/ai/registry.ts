import type { AIToolDefinition, PlannedTool } from "./types";
import { completeTaskTool, createTaskTool, listOpenTasksTool } from "./tools/tasks";
import {
  addContactTool, addSiteAddressTool, archiveCustomerTool, createCustomerTool, getCustomerTool, searchCustomersTool, updateCustomerTool,
} from "./tools/customers";

/**
 * Registered (executable) AI tools. To add a tool:
 *  1. implement/extend the domain service (src/domain/<module>/service.ts)
 *  2. add an AIToolDefinition in src/lib/ai/tools/<module>.ts that CALLS that service
 *  3. classify it (read/draft/consequential) and list required permissions
 *  4. register it below and add a unit test in tests/unit/ai.test.ts
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous registry; inputs validated by each tool's schema
export const AI_TOOLS: ReadonlyArray<AIToolDefinition<any, any>> = [
  searchCustomersTool,
  getCustomerTool,
  createCustomerTool,
  updateCustomerTool,
  addContactTool,
  addSiteAddressTool,
  archiveCustomerTool,
  listOpenTasksTool,
  createTaskTool,
  completeTaskTool,
];

/** Designed in the product spec; intentionally NOT executable yet. */
export const PLANNED_AI_TOOLS: ReadonlyArray<PlannedTool> = [
  { name: "create_quote", actionClass: "draft", phase: "future", description: "Draft a quote for a customer" },
  { name: "create_invoice", actionClass: "draft", phase: "future", description: "Draft an invoice" },
  { name: "record_expense", actionClass: "draft", phase: "future", description: "Record an expense from a receipt" },
  { name: "schedule_job", actionClass: "draft", phase: "future", description: "Schedule a job" },
  { name: "search_messages", actionClass: "read", phase: "future", description: "Search conversations" },
  { name: "send_whatsapp", actionClass: "consequential", phase: "future", description: "Send a WhatsApp message" },
  { name: "send_email", actionClass: "consequential", phase: "future", description: "Send an email" },
  { name: "send_invoice", actionClass: "consequential", phase: "future", description: "Send an invoice to a customer" },
  { name: "generate_document", actionClass: "draft", phase: "future", description: "Generate a document from a template" },
  { name: "get_cashflow", actionClass: "read", phase: "future", description: "Summarise cash flow" },
  { name: "get_outstanding_invoices", actionClass: "read", phase: "future", description: "List unpaid invoices" },
];

export function findTool(name: string) {
  return AI_TOOLS.find((t) => t.name === name);
}

export function findPlannedTool(name: string) {
  return PLANNED_AI_TOOLS.find((t) => t.name === name);
}
