import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/** amount must be a decimal string from the database (never a JS float). */
export function MoneyDisplay({ amount, currency, className }: { amount: string; currency: string; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{formatMoney(amount, currency)}</span>;
}
