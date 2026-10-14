/** Route access rules — pure functions so they are unit-testable. */
export const AUTH_ROUTES = ["/login", "/register"] as const;
export const PROTECTED_PREFIXES = ["/app", "/onboarding"] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isAuthPath(pathname: string): boolean {
  return AUTH_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Only allow same-origin relative redirects (prevents open-redirects). */
export function safeNextPath(next: string | null | undefined, fallback = "/app/today"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
