import Link from "next/link";
export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">That page doesn&apos;t exist or you don&apos;t have access to it.</p>
      <Link href="/app/today" className="mt-4 inline-block text-sm text-primary underline">Go to Today</Link>
    </div>
  );
}
