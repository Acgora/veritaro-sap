import type { AIToolDefinition, PlannedTool } from "./types";
import { completeTaskTool, createTaskTool, listOpenTasksTool } from "./tools/tasks";
import {
  addContactTool, addSiteAddressTool, archiveCustomerTool, createCustomerTool, getCustomerTool, searchCustomersTool, updateCustomerTool,
} from "./tools/customers";
import { convertLeadTool, createLeadTool, findLeadsTool, getLeadTool, listLeadsNeedingFollowUpTool, updateLeadStatusTool } from "./tools/leads";
import {
  acceptQuoteTool, addQuoteLineTool, createInvoiceFromQuoteTool, createQuoteDraftTool, declineQuoteTool, findQuotesTool, getQuoteTool,
  listQuotesNeedingFollowUpTool, markQuoteSentTool,
} from "./tools/quotes";
import {
  assignJobTool, completeJobTool, createInvoiceFromJobTool, createJobFromQuoteTool, findJobsTool, listJobsForDateTool, listTeamMembersTool,
  scheduleJobTool, startJobTool,
} from "./tools/jobs";
import {
  findInvoicesTool, getCustomerBalanceTool, getInvoiceTool, getTodaySummaryTool, issueInvoiceTool, listOverdueInvoicesTool, listUnpaidInvoicesTool,
  recordPaymentTool, sendMessageTool, voidInvoiceTool,
} from "./tools/invoices";
import { draftReplyTool, getConversationTool, logCommunicationTool } from "./tools/inbox";

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
  // Phase 003 — leads
  findLeadsTool, getLeadTool, listLeadsNeedingFollowUpTool, createLeadTool, updateLeadStatusTool, convertLeadTool,
  // quotes
  findQuotesTool, getQuoteTool, listQuotesNeedingFollowUpTool, createQuoteDraftTool, addQuoteLineTool,
  markQuoteSentTool, acceptQuoteTool, declineQuoteTool, createInvoiceFromQuoteTool,
  // jobs
  findJobsTool, listJobsForDateTool, listTeamMembersTool, createJobFromQuoteTool, scheduleJobTool, assignJobTool, startJobTool,
  completeJobTool, createInvoiceFromJobTool,
  // invoices, payments, today
  findInvoicesTool, getInvoiceTool, getCustomerBalanceTool, listUnpaidInvoicesTool, listOverdueInvoicesTool, getTodaySummaryTool,
  issueInvoiceTool, voidInvoiceTool, recordPaymentTool,
  // communications
  logCommunicationTool, getConversationTool, draftReplyTool, sendMessageTool,
];

/** Designed in the product spec; intentionally NOT executable yet. */
export const PLANNED_AI_TOOLS: ReadonlyArray<PlannedTool> = [
  { name: "record_expense", actionClass: "draft", phase: "future", description: "Record an expense from a receipt" },
  { name: "send_whatsapp", actionClass: "consequential", phase: "future", description: "Send a WhatsApp message (needs a connected channel)" },
  { name: "send_email", actionClass: "consequential", phase: "future", description: "Send an email (needs a connected channel)" },
  { name: "send_invoice", actionClass: "consequential", phase: "future", description: "Send an invoice to a customer (needs a connected channel)" },
  { name: "generate_document", actionClass: "draft", phase: "future", description: "Generate a document from a template" },
  { name: "get_cashflow", actionClass: "read", phase: "future", description: "Summarise cash flow" },
];

export function findTool(name: string) {
  return AI_TOOLS.find((t) => t.name === name);
}

export function findPlannedTool(name: string) {
  return PLANNED_AI_TOOLS.find((t) => t.name === name);
}
