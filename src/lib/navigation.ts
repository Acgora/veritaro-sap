import {
  Briefcase, Building2, CalendarDays, CheckSquare, FileText, Hammer, Inbox, LayoutGrid, Receipt,
  Settings, ShoppingBag, Sun, Users, Wallet, Landmark, BarChart3, BookOpen, UserRound, Target, FileSignature,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";

export interface NavChild {
  label: string;
  href: string;
  /** false = future module placeholder */
  live: boolean;
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
      { label: "Leads", href: "/app/sales/leads", live: false },
      { label: "Quotes", href: "/app/sales/quotes", live: false },
      { label: "Customers", href: "/app/sales/customers", live: true },
    ],
  },
  {
    key: "work", label: "Work", href: "/app/work", icon: Hammer,
    children: [
      { label: "Tasks", href: "/app/work/tasks", live: true },
      { label: "Jobs", href: "/app/work/jobs", live: false },
      { label: "Calendar", href: "/app/work/calendar", live: false },
    ],
  },
  {
    key: "money", label: "Money", href: "/app/money", icon: Wallet, permission: "money.access",
    children: [
      { label: "Invoices", href: "/app/money/invoices", live: false },
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
  { key: "task", label: "Task", icon: CheckSquare, live: true, href: "/app/work/tasks?new=1", permission: "tasks.create" },
  { key: "customer", label: "Customer", icon: UserRound, live: true, href: "/app/sales/customers?new=1", permission: "customers.create" },
  { key: "lead", label: "Lead", icon: Target, live: false, href: "/app/new/lead" },
  { key: "quote", label: "Quote", icon: FileSignature, live: false, href: "/app/new/quote" },
  { key: "invoice", label: "Invoice", icon: Receipt, live: false, href: "/app/new/invoice" },
  { key: "expense", label: "Expense", icon: Wallet, live: false, href: "/app/new/expense" },
  { key: "job", label: "Job", icon: Briefcase, live: false, href: "/app/new/job" },
  { key: "booking", label: "Booking", icon: CalendarDays, live: false, href: "/app/new/booking" },
  { key: "document", label: "Document", icon: FileText, live: false, href: "/app/new/document" },
  { key: "employee", label: "Employee", icon: Users, live: false, href: "/app/new/employee" },
  { key: "supplier", label: "Supplier", icon: Landmark, live: false, href: "/app/new/supplier" },
];

/** Mobile "+" sheet — field-first actions. */
export const MOBILE_QUICK_ACTIONS: { key: string; label: string; href: string; live: boolean; icon: LucideIcon }[] = [
  { key: "ask", label: "Ask AI", href: "#ask-ai", live: true, icon: LayoutGrid },
  { key: "receipt_photo", label: "Take receipt photo", href: "/app/new/receipt-photo", live: false, icon: Receipt },
  { key: "job_photo", label: "Take job photo", href: "/app/new/job-photo", live: false, icon: Hammer },
  { key: "task", label: "Create task", href: "/app/work/tasks?new=1", live: true, icon: CheckSquare },
  { key: "quote", label: "Create quote", href: "/app/new/quote", live: false, icon: FileSignature },
  { key: "invoice", label: "Create invoice", href: "/app/new/invoice", live: false, icon: Receipt },
  { key: "customer", label: "Create customer", href: "/app/sales/customers?new=1", live: true, icon: UserRound },
  { key: "expense", label: "Create expense", href: "/app/new/expense", live: false, icon: Wallet },
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
