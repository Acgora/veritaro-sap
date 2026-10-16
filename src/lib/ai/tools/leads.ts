import { z } from "zod";
import { convertLead, createLead, findLeads, findLeadsNeedingFollowUp, getLead, setLeadStatus } from "@/domain/leads/service";
import { LEAD_SOURCES } from "@/lib/status";
import { ok } from "@/lib/errors";
import type { AIToolDefinition } from "../types";

const findInput = z.object({ query: z.string().trim().min(1).max(100).describe("Name, company, email or phone fragment") });

export const findLeadsTool: AIToolDefinition<typeof findInput> = {
  name: "find_leads",
  description: "Find leads (enquiries) by name, company, email or phone. Returns up to 8 with id, title, name, status, linked customerId.",
  actionClass: "read",
  requiredPermissions: ["leads.read"],
  inputSchema: findInput,
  execute: async (ctx, i) => {
    const r = await findLeads(ctx, i.query, 8);
    if (!r.ok) return r;
    return ok({ leads: r.data.map((l) => ({ id: l.id, title: l.title, name: l.name, status: l.status, phone: l.phone, email: l.email, customerId: l.customerId })) });
  },
  summarise: (i) => `Find leads “${i.query}”`,
};

const followInput = z.object({ mineOnly: z.boolean().optional() });

export const listLeadsNeedingFollowUpTool: AIToolDefinition<typeof followInput> = {
  name: "list_leads_needing_followup",
  description: "Leads that need a follow-up now (scheduled follow-up due, or no activity for the configured number of days). Deterministic rule.",
  actionClass: "read",
  requiredPermissions: ["leads.read"],
  inputSchema: followInput,
  execute: async (ctx, i) => {
    const r = await findLeadsNeedingFollowUp(ctx, { limit: 15, assignedToMe: i.mineOnly });
    if (!r.ok) return r;
    return ok({
      followupDays: r.data.followupDays,
      leads: r.data.items.map((l) => ({ id: l.id, title: l.title, name: l.name, status: l.status, reason: l.reason, dueAt: l.dueAt })),
    });
  },
  summarise: () => "List leads needing follow-up",
  card: () => ({ label: "Open leads", href: "/app/sales/leads" }),
};

const createInput = z.object({
  personName: z.string().trim().max(200).optional(),
  companyName: z.string().trim().max(200).optional(),
  email: z.string().trim().max(320).optional(),
  phone: z.string().trim().max(40).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  serviceSummary: z.string().trim().max(1000).optional().describe("What they want, e.g. 'Office cleaning'"),
  siteAddressText: z.string().trim().max(500).optional().describe("Where, e.g. 'Stellenbosch'"),
  requestedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  estimatedValue: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).optional().describe("Only if the user stated a value"),
  notes: z.string().trim().max(2000).optional(),
}).refine((v) => v.personName || v.companyName, "A person or company name is needed");

export const createLeadTool: AIToolDefinition<typeof createInput, { id: string; title: string }> = {
  name: "create_lead",
  description: "Add a new lead (enquiry). Use find_leads first if the person may already be a lead. Never invent contact details.",
  actionClass: "draft",
  requiredPermissions: ["leads.write"],
  inputSchema: createInput,
  execute: (ctx, i) => createLead(ctx, { ...i, source: i.source ?? "manual" }),
  summarise: (i) => `Add lead ${[i.personName, i.companyName].filter(Boolean).join(" from ")}`,
  card: (_i, out) => ({ label: `Lead: ${out.title}`, href: `/app/sales/leads/${out.id}` }),
  focus: (_i, out) => [{ type: "lead", id: out.id, label: out.title }],
};

const statusInput = z.object({
  leadId: z.uuid(),
  status: z.enum(["contacted", "qualified", "quote_needed", "lost"]),
  lostReason: z.string().trim().max(500).optional().describe("Required when status is lost"),
});

export const updateLeadStatusTool: AIToolDefinition<typeof statusInput> = {
  name: "update_lead_status",
  description: "Move a lead through the pipeline (contacted, qualified, quote needed, lost with reason). 'Won' happens automatically when its quote is accepted.",
  actionClass: "draft",
  requiredPermissions: ["leads.write"],
  inputSchema: statusInput,
  execute: (ctx, i) => setLeadStatus(ctx, i.leadId, { status: i.status, lostReason: i.lostReason }),
  summarise: (i) => `Mark lead ${i.status.replace("_", " ")}`,
  card: (i) => ({ label: "Open lead", href: `/app/sales/leads/${i.leadId}` }),
};

const convertInput = z.object({
  leadId: z.uuid(),
  existingCustomerId: z.uuid().optional().describe("Link to this existing customer instead of creating one"),
  allowDuplicate: z.boolean().optional().describe("Only true after the user confirmed the matches shown are different customers"),
});

export const convertLeadTool: AIToolDefinition<typeof convertInput> = {
  name: "convert_lead_to_customer",
  description:
    "Turn a lead into a customer (or link it to an existing customer). If possible duplicates are returned, list them and ask the user which to link, or whether to create a new one.",
  actionClass: "draft",
  requiredPermissions: ["leads.write", "customers.create"],
  inputSchema: convertInput,
  execute: async (ctx, i) => {
    const r = await convertLead(ctx, i.leadId, { existingCustomerId: i.existingCustomerId, allowDuplicate: i.allowDuplicate });
    if (!r.ok) return r;
    return ok(r.data);
  },
  summarise: () => "Convert lead to customer",
  card: (i, out) => {
    const o = out as { customerId?: string };
    return o.customerId ? { label: "Open customer", href: `/app/sales/customers/${o.customerId}` } : { label: "Open lead", href: `/app/sales/leads/${i.leadId}` };
  },
  focus: (_i, out) => {
    const o = out as { customerId?: string };
    return o.customerId ? [{ type: "customer", id: o.customerId, label: "converted customer" }] : [];
  },
};

const getInput = z.object({ leadId: z.uuid() });

export const getLeadTool: AIToolDefinition<typeof getInput> = {
  name: "get_lead",
  description: "Get one lead's details including linked customer and quotes.",
  actionClass: "read",
  requiredPermissions: ["leads.read"],
  inputSchema: getInput,
  execute: async (ctx, i) => {
    const r = await getLead(ctx, i.leadId);
    if (!r.ok) return r;
    const { lead: l, customer, quotes } = r.data;
    return ok({
      id: l.id, title: l.title, person: l.person_name, company: l.company_name, phone: l.phone, email: l.email, status: l.status,
      service: l.service_summary, site: l.site_address_text, nextFollowUpAt: l.next_follow_up_at, customer,
      quotes: quotes.slice(0, 5),
    });
  },
  summarise: () => "Look up a lead",
  card: (i) => ({ label: "Open lead", href: `/app/sales/leads/${i.leadId}` }),
  focus: (i, out) => [{ type: "lead", id: i.leadId, label: String((out as { title?: string }).title ?? "lead") }],
};
