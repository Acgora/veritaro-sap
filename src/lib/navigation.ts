import {
  Briefcase, Building2, CalendarDays, CheckSquare, FileText, Hammer, Inbox, LayoutGrid, Receipt,
  Settings, ShoppingBag, Banknote, Camera, Sun, Users, Wallet, Landmark, BarChart3, BookOpen, UserRound, Target, FileSignature,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";

export interface NavChild {
  label: string;
  href: string;
  /** false = future module placeholder */
  live: boolean;
  /** Hidden unless the user holds this permission. */
  permission?: Permission;
}

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Shown only if the user holds this permission. undefined = everyone. */
  permission?: Permission;
  children?: NavChild[];
}

export const NAV_ITEMS: NavItem[] = [
  { key: "today", label: "Today", href: "/app/today", icon: Sun },
  { key: "inbox", label: "Inbox", href: "/app/inbox", icon: Inbox, permission: "inbox.access" },
  {
    key: "sales", label: "Sales", href: "/app/sales", icon: ShoppingBag, permission: "sales.access",
    children: [
      { label: "Leads", href: "/app/sales/leads", live: true, permission: "leads.read" },
      { label: "Quotes", href: "/app/sales/quotes", live: true, permission: "quotes.read" },
      { label: "Customers", href: "/app/sales/customers", live: true, permission: "customers.read" },
    ],
  },
  {
    key: "work", label: "Work", href: "/app/work", icon: Hammer,
    children: [
      { label: "Jobs", href: "/app/work/jobs", live: true },
      { label: "Calendar", href: "/app/work/calendar", live: true },
      { label: "Tasks", href: "/app/work/tasks", live: true },
    ],
  },
  {
    key: "money", label: "Money", href: "/app/money", icon: Wallet, permission: "money.access",
    children: [
      { label: "Overview", href: "/app/money", live: true },
      { label: "Invoices", href: "/app/money/invoices", live: true, permission: "invoices.read" },
      { label: "Payments", href: "/app/money/payments", live: true, permission: "payments.read" },
      { label: "Expenses", href: "/app/money/expenses", live: false },
      { label: "Banking", href: "/app/money/banking", live: false },
      { label: "Reports", href: "/app/money/reports", live: false },
      { label: "Accounting", href: "/app/money/accounting", live: false },
    ],
  },
  { key: "team", label: "Team", href: "/app/team", icon: Users, permission: "team.access" },
  { key: "documents", label: "Documents", href: "/app/documents", icon: FileText, permission: "documents.access" },
  { key: "business", label: "Business", href: "/app/business", icon: Building2, permission: "business.access" },
  {
    key: "settings", label: "Settings", href: "/app/settings", icon: Settings,
    children: [
      { label: "Organisation", href: "/app/settings/organisation", live: true },
      { label: "Quotes & invoices", href: "/app/settings/financial", live: true, permission: "settings.read" },
      { label: "Members", href: "/app/settings/members", live: true },
      { label: "My profile", href: "/app/settings/profile", live: true },
      { label: "Preferences", href: "/app/settings/preferences", live: true },
      { label: "AI usage", href: "/app/settings/ai", live: true },
    ],
  },
];

export const MOBILE_PRIMARY_KEYS = ["today", "inbox", "work"] as const;

export interface QuickCreateItem {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Live items open a real form; others route to an honest "coming next" screen. */
  live: boolean;
  href: string;
  permission?: Permission;
}

export const QUICK_CREATE_ITEMS: QuickCreateItem[] = [
  { key: "lead", label: "Lead", icon: Target, live: true, href: "/app/sales/leads?new=1", permission: "leads.write" },
  { key: "customer", label: "Customer", icon: UserRound, live: true, href: "/app/sales/customers?new=1", permission: "customers.create" },
  { key: "quote", label: "Quote", icon: FileSignature, live: true, href: "/app/sales/quotes/new", permission: "quotes.write" },
  { key: "job", label: "Job", icon: Briefcase, live: true, href: "/app/work/jobs?new=1", permission: "jobs.write" },
  { key: "invoice", label: "Invoice", icon: Receipt, live: true, href: "/app/money/invoices?new=1", permission: "invoices.write" },
  { key: "payment", label: "Payment", icon: Banknote, live: true, href: "/app/money/payments?new=1", permission: "payments.record" },
  { key: "task", label: "Task", icon: CheckSquare, live: true, href: "/app/work/tasks?new=1", permission: "tasks.create" },
  { key: "expense", label: "Expense", icon: Wallet, live: false, href: "/app/new/expense" },
  { key: "document", label: "Document", icon: FileText, live: false, href: "/app/new/document" },
  { key: "employee", label: "Employee", icon: Users, live: false, href: "/app/new/employee" },
  { key: "supplier", label: "Supplier", icon: Landmark, live: false, href: "/app/new/supplier" },
];

/** Mobile "+" sheet — field-first actions, thumb-friendly order. */
export const MOBILE_QUICK_ACTIONS: { key: string; label: string; href: string; live: boolean; icon: LucideIcon; permission?: Permission }[] = [
  { key: "ask", label: "Ask AI", href: "#ask-ai", live: true, icon: LayoutGrid, permission: "ai.use" },
  { key: "job_photo", label: "Job photo", href: "/app/work/jobs?photo=1", live: true, icon: Camera, permission: "jobs.work" },
  { key: "lead", label: "Lead", href: "/app/sales/leads?new=1", live: true, icon: Target, permission: "leads.write" },
  { key: "customer", label: "Customer", href: "/app/sales/customers?new=1", live: true, icon: UserRound, permission: "customers.create" },
  { key: "quote", label: "Quote", href: "/app/sales/quotes/new", live: true, icon: FileSignature, permission: "quotes.write" },
  { key: "job", label: "Job", href: "/app/work/jobs?new=1", live: true, icon: Briefcase, permission: "jobs.write" },
  { key: "invoice", label: "Invoice", href: "/app/money/invoices?new=1", live: true, icon: Receipt, permission: "invoices.write" },
  { key: "payment", label: "Payment", href: "/app/money/payments?new=1", live: true, icon: Banknote, permission: "payments.record" },
  { key: "task", label: "Task", href: "/app/work/tasks?new=1", live: true, icon: CheckSquare, permission: "tasks.create" },
  { key: "receipt_photo", label: "Receipt photo", href: "/app/new/receipt-photo", live: false, icon: Receipt },
];

/** Placeholder descriptions for future-module routes. */
export const FUTURE_ENTITIES: Record<string, { title: string; description: string; icon: LucideIcon }> = {
  customer: { title: "Customers", description: "Store customers and contacts once, then reuse them across quotes, jobs and invoices.", icon: UserRound },
  lead: { title: "Leads", description: "New enquiries from WhatsApp, email and your website will appear here.", icon: Target },
  quote: { title: "Quotes", description: "Create professional quotes with VAT calculated for you, then turn accepted quotes into jobs.", icon: FileSignature },
  invoice: { title: "Invoices", description: "Invoice from completed jobs and track what's owed. Backed by proper double-entry bookkeeping.", icon: Receipt },
  expense: { title: "Expenses", description: "Capture expenses and receipts and link them to jobs.", icon: Wallet },
  job: { title: "Jobs", description: "Turn accepted quotes into scheduled jobs and assign your team.", icon: Briefcase },
  booking: { title: "Bookings", description: "Schedule customer bookings on your calendar.", icon: CalendarDays },
  document: { title: "Documents", description: "Generate and store quotes, certificates and compliance documents.", icon: FileText },
  employee: { title: "Employees", description: "Manage staff, timesheets and leave.", icon: Users },
  supplier: { title: "Suppliers", description: "Keep track of who you buy from.", icon: Landmark },
  "receipt-photo": { title: "Receipt capture", description: "Photograph a receipt and the supplier, amount, VAT and date will be read for you.", icon: Receipt },
  "job-photo": { title: "Job photos", description: "Attach before-and-after photos to jobs from your phone.", icon: Hammer },
  reports: { title: "Reports", description: "Profit & loss, VAT and cash flow reports.", icon: BarChart3 },
  accounting: { title: "Accounting", description: "Chart of accounts and journals — the double-entry engine behind Money.", icon: BookOpen },
};

export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
