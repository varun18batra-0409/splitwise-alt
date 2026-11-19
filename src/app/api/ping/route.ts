// "Is there a signal?" A tiny answer: no database, never kept by the browser or the hosting.
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", { headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
}
