"use client";
import { Search } from "lucide-react";
import { Sidebar } from "./sidebar";
import { OrganisationSwitcher } from "./organisation-switcher";
import { NotificationMenu } from "./notification-menu";
import { UserMenu } from "./user-menu";
import { QuickCreate } from "./quick-create";
import { CommandPalette } from "./command-palette";
import { AICommandBar, AskDialog } from "./ai-command-bar";
import { MobileNavigation } from "./mobile-navigation";
import { ShellProvider, useShell } from "./shell-context";
import type { ShellData } from "./types";

function SearchTrigger() {
  const { setCommandOpen } = useShell();
  return (
    <button
      type="button"
      onClick={() => setCommandOpen(true)}
      className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-sm text-muted-foreground hover:bg-surface-raised md:w-72"
      aria-label="Search and commands"
    >
      <Search className="size-4" aria-hidden />
      <span className="hidden md:inline">Search or jump to…</span>
      <kbd className="ml-auto hidden rounded border border-border px-1.5 text-[10px] font-medium md:inline">⌘K</kbd>
    </button>
  );
}

export function AppShell({ data, children }: { data: ShellData; children: React.ReactNode }) {
  return (
    <ShellProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">
        Skip to content
      </a>
      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-surface/95 px-3 backdrop-blur md:px-4">
          <OrganisationSwitcher data={data} />
          <div className="flex-1" />
          <SearchTrigger />
          <div className="hidden md:block"><QuickCreate permissions={data.permissions} /></div>
          <NotificationMenu notifications={data.notifications} />
          <UserMenu data={data} />
        </header>
        <div className="flex flex-1">
          <aside className="sticky top-12 hidden h-[calc(100dvh-3rem)] w-56 shrink-0 overflow-y-auto border-r border-border bg-surface md:block">
            <Sidebar permissions={data.permissions} />
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-5 md:px-6 md:pb-6">
              {children}
            </main>
            <AICommandBar enabled={data.permissions.includes("ai.use")} />
          </div>
        </div>
      </div>
      <MobileNavigation permissions={data.permissions} />
      <CommandPalette permissions={data.permissions} />
      <AskDialog enabled={data.permissions.includes("ai.use")} />
    </ShellProvider>
  );
}
