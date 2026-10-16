import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Status chips + search + pagination shared by the quote and invoice lists (server-rendered links/forms). */
export function buildHref(pathname: string, base: Record<string, string | undefined>, patch: Record<string, string | number | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v !== undefined && v !== "" && !(k === "page" && String(v) === "1")) q.set(k, String(v));
  const s = q.toString();
  return s ? `${pathname}?${s}` : pathname;
}

export function StatusChips<T extends string>({ pathname, filters, labels, current, base }: {
  pathname: string; filters: readonly T[]; labels: Record<T, string>; current: T; base: Record<string, string | undefined>;
}) {
  return (
    <nav aria-label="Filter by status" className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1">
      {filters.map((f) => (
        <Link key={f} href={buildHref(pathname, base, { status: f === "all" ? undefined : f, page: undefined })}
          aria-current={f === current ? "page" : undefined}
          className={cn("inline-flex h-9 shrink-0 items-center rounded-full border border-border px-3 text-sm",
            f === current ? "border-primary bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-raised")}>
          {labels[f]}
        </Link>
      ))}
    </nav>
  );
}

export function SearchBox({ pathname, q, status, placeholder, label }: { pathname: string; q: string; status: string; placeholder: string; label: string }) {
  return (
    <form role="search" action={pathname} className="mb-3 flex gap-2">
      {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-3 size-4 text-muted-foreground" aria-hidden />
        <label htmlFor="doc-search" className="sr-only">{label}</label>
        <Input id="doc-search" name="q" defaultValue={q} placeholder={placeholder} className="h-10 pl-8" />
      </div>
      <Button type="submit" variant="secondary" size="lg">Search</Button>
    </form>
  );
}

export function Pagination({ pathname, base, page, total, pageSize, noun }: {
  pathname: string; base: Record<string, string | undefined>; page: number; total: number; pageSize: number; noun: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
      <span>Page {page} of {pages} · {total} {noun}</span>
      <div className="flex gap-2">
        {page > 1 ? <Button asChild variant="secondary" size="sm"><Link href={buildHref(pathname, base, { page: page - 1 })}>Previous</Link></Button> : null}
        {page < pages ? <Button asChild variant="secondary" size="sm"><Link href={buildHref(pathname, base, { page: page + 1 })}>Next</Link></Button> : null}
      </div>
    </nav>
  );
}
