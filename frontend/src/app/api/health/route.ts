// Process heartbeat only: do not import database, session or business modules here.
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true }, {
    headers: { "Cache-Control": "no-store" },
  });
}
