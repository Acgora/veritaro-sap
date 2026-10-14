"use client";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Sparkles } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { visibleNav } from "./sidebar";
import { quickCreateFor } from "./quick-create";
import { useShell } from "./shell-context";

const itemCls =
  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-surface-raised [&_svg]:size-4 [&_svg]:text-muted-foreground";
const groupCls = "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground";

/** Global Cmd/Ctrl+K: navigate, create, or hand off to the assistant. */
export function CommandPalette({ permissions }: { permissions: string[] }) {
  const router = useRouter();
  const { commandOpen, setCommandOpen, openAsk } = useShell();
  const go = (href: string) => {
    setCommandOpen(false);
    router.push(href);
  };
  const nav = visibleNav(permissions);
  const creates = quickCreateFor(permissions);

  return (
    <DialogPrimitive.Root open={commandOpen} onOpenChange={setCommandOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[15dvh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          <DialogPrimitive.Title className="sr-only">Command menu</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search pages and actions</DialogPrimitive.Description>
          <Command label="Command menu" loop>
            <Command.Input placeholder="Search pages and actions…" className="h-11 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground" />
            <Command.List className="max-h-80 overflow-y-auto p-1.5">
              <Command.Empty className="p-4 text-center text-sm text-muted-foreground">No results.</Command.Empty>
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
