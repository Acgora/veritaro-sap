import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthPath, isProtectedPath } from "@/lib/routes";
import type { Database } from "@/types/database.types";

/** Plain diagnostic page instead of Vercel's opaque MIDDLEWARE_INVOCATION_FAILED. No secrets are printed. */
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Normalises common copy/paste slips (iPad auto-capitalisation, spaces, quotes, trailing slash). */
export function normaliseSupabaseUrl(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, "").trim().toLowerCase().replace(/\/+$/, "");
}

function configError(message: string) {
  console.error(`[middleware] ${message}`);
  message = escapeHtml(message);
  return new NextResponse(
    `<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:2rem;max-width:40rem">
<h1 style="font-size:1.2rem">Veritaro is not configured correctly</h1><p>${message}</p></body>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"].filter(Boolean);
  if (missing.length > 0) {
    return configError(`Missing environment variable(s): ${missing.join(", ")}. Add them in Vercel → Settings → Environment Variables, then redeploy.`);
  }
  const supabaseUrl = normaliseSupabaseUrl(url!);
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl) && !supabaseUrl.startsWith("http://localhost")) {
    // The URL is public (it is shipped to every browser), so showing it is safe and makes typos obvious.
    return configError(
      `NEXT_PUBLIC_SUPABASE_URL is not a valid Supabase URL. Expected https://<project-ref>.supabase.co — received "${url!.slice(0, 120)}" (${url!.length} characters).`,
    );
  }

  let response = NextResponse.next({ request });

  try {
    const supabase = createServerClient<Database>(supabaseUrl, key!.trim().replace(/^["']|["']$/g, ""), {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });

    // getUser() validates the JWT with Supabase Auth (getSession() would trust the cookie).
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { pathname, search } = request.nextUrl;

    if (!user && isProtectedPath(pathname)) {
      const to = request.nextUrl.clone();
      to.pathname = "/login";
      to.search = `?next=${encodeURIComponent(pathname + search)}`;
      return NextResponse.redirect(to);
    }

    if (user && isAuthPath(pathname)) {
      const to = request.nextUrl.clone();
      to.pathname = "/app/today";
      to.search = "";
      return NextResponse.redirect(to);
    }

    return response;
  } catch (error) {
    const e = error as { name?: string; message?: string };
    return configError(`Could not reach Supabase Auth (${e?.name ?? "Error"}). Check the Supabase URL and publishable key in Vercel.`);
  }
}
