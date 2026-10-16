"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Briefcase, FileSignature, FileText, Sparkles, Target, User, Users, type LucideIcon } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { visibleNav } from "./sidebar";
import { quickCreateFor } from "./quick-create";
import { useShell } from "./shell-context";
import { EntityStatus } from "@/components/common/entity-status";
import { StatusBadge } from "@/components/common/status-badge";
import { groupSearchResults, type SearchEntityType, type SearchResult } from "@/domain/search/service";
import { globalSearchAction } from "@/app/app/search/actions";

const SEARCH_ICONS: Record<SearchEntityType, LucideIcon> = {
  customer: Users, contact: User, lead: Target, quote: FileSignature, job: Briefcase, invoice: FileText,
};
const SEARCH_DEBOUNCE_MS = 250;

/** Debounced global search (≥2 chars). Latest request wins; stale responses are ignored. */
function useGlobalSearch(query: string) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    const id = ++seq.current;
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await globalSearchAction(q);
        if (id !== seq.current) return;
        if (r.ok) { setResults(r.data); setError(null); } else { setResults([]); setError(r.error); }
      } catch {
        if (id === seq.current) { setResults([]); setError("Search isn't available right now."); }
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);
  return { results, loading, error };
}

const itemCls =
  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-surface-raised [&_svg]:size-4 [&_svg]:text-muted-foreground";
const groupCls = "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground";

/** Global Cmd/Ctrl+K: navigate, create, or hand off to the assistant. */
export function CommandPalette({ permissions }: { permissions: string[] }) {
  const router = useRouter();
  const { commandOpen, setCommandOpen, openAsk } = useShell();
  const go = (href: string) => {
    setCommandOpen(false);
    setQuery("");
    router.push(href);
  };
  const nav = visibleNav(permissions);
  const creates = quickCreateFor(permissions);
  const [query, setQuery] = useState("");
  const { results, loading, error } = useGlobalSearch(commandOpen ? query : "");
  const groups = groupSearchResults(results);
  const onOpenChange = (open: boolean) => {
    setCommandOpen(open);
    if (!open) setQuery("");
  };

  return (
    <DialogPrimitive.Root open={commandOpen} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[15dvh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          <DialogPrimitive.Title className="sr-only">Command menu</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search customers, leads, quotes, jobs, invoices, pages and actions</DialogPrimitive.Description>
          <Command label="Command menu" loop>
            <Command.Input value={query} onValueChange={setQuery} placeholder="Search customers, quotes, jobs, invoices or pages…" className="h-11 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground" />
            <Command.List className="max-h-80 overflow-y-auto p-1.5">
              {loading ? <Command.Loading><p className="px-2 py-1.5 text-xs text-muted-foreground">Searching…</p></Command.Loading> : null}
              {!loading ? <Command.Empty className="p-4 text-center text-sm text-muted-foreground">No results.</Command.Empty> : null}
              {error ? <p className="px-2 py-1.5 text-xs text-muted-foreground" role="status">{error}</p> : null}
              {groups.map((g) => {
                const Icon = SEARCH_ICONS[g.type];
                return (
                  <Command.Group key={g.type} heading={g.label} className={groupCls}>
                    {g.items.map((r) => (
                      <Command.Item
                        key={r.key}
                        value={`search ${r.key} ${r.title}`}
                        keywords={[query, r.subtitle ?? ""]}
                        className={itemCls}
                        onSelect={() => go(r.href)}
                      >
                        <Icon />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{r.title}</span>
                          {r.subtitle ? <span className="block truncate text-xs text-muted-foreground">{r.subtitle}</span> : null}
                        </span>
                        {r.statusEntity && r.status ? (
                          <EntityStatus entity={r.statusEntity} status={r.status} className="shrink-0" />
                        ) : r.entityType === "customer" && r.status === "archived" ? (
                          <StatusBadge className="shrink-0">Archived</StatusBadge>
                        ) : null}
                      </Command.Item>
                    ))}
                  </Command.Group>
                );
              })}
              <Command.Group heading="Assistant" className={groupCls}>
                <Command.Item className={itemCls} onSelect={() => { setCommandOpen(false); openAsk(); }}>
                  <Sparkles /> Ask AI…
                </Command.Item>
              </Command.Group>
              <Command.Group heading="Create" className={groupCls}>
                {creates.map((c) => (
                  <Command.Item key={c.key} value={`new ${c.label}`} className={itemCls} onSelect={() => go(c.href)}>
                    <c.icon /> New {c.label.toLowerCase()}
                    {!c.live ? <span className="ml-auto text-xs text-muted-foreground">soon</span> : null}
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Go to" className={groupCls}>
                {nav.flatMap((n) => [
                  <Command.Item key={n.href} value={n.label} className={itemCls} onSelect={() => go(n.href)}>
                    <n.icon /> {n.label}
                  </Command.Item>,
                  ...(n.children ?? []).map((c) => (
                    <Command.Item key={c.href} value={`${n.label} ${c.label}`} className={itemCls} onSelect={() => go(c.href)}>
                      <span className="w-4" aria-hidden /> {n.label} › {c.label}
                    </Command.Item>
                  )),
                ])}
              </Command.Group>
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
