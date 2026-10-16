import { z } from "zod";
import { getServiceContext } from "@/lib/service-context";
import { getInvoicePdf, pdfResponse } from "@/domain/documents/service";

// @react-pdf/renderer needs Node APIs; it is in Next's built-in serverExternalPackages list.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/documents/invoices/:id/pdf[?download=1]
 * Uses the signed-in user's Supabase client (RLS + storage policies). 404 when not visible.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const ctx = await getServiceContext();
  const r = await getInvoicePdf(ctx, id);
  if (!r.ok) {
    const notFound = r.error.startsWith("We couldn't find");
    return new Response(notFound ? "Not found" : r.error, { status: notFound ? 404 : 500, headers: { "Cache-Control": "no-store" } });
  }
  const download = new URL(request.url).searchParams.get("download") === "1";
  return pdfResponse(r.data, download);
}
