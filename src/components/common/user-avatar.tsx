import { cn, initials } from "@/lib/utils";

export function UserAvatar({ name, size = "md", className }: { name: string | null | undefined; size?: "sm" | "md"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-secondary font-medium text-secondary-foreground",
        size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
