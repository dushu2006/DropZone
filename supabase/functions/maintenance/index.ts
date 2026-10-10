import { createClient } from "npm:@supabase/supabase-js@2.117.3";
// Scheduler/operator-only endpoint. No browser CORS and no frontend secret.
Deno.serve(async (req) => {
  const secret = Deno.env.get("DROPZONE_MAINTENANCE_SECRET");
  if (
    !secret ||
    req.method !== "POST" ||
    req.headers.get("X-Maintenance-Secret") !== secret
  )
    return new Response("Forbidden", { status: 403 });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const run = await admin.rpc("dz_maintenance");
    if (run.error) throw run.error;
    const batch = await admin.rpc("dz_cleanup_batch");
    if (batch.error) throw batch.error;
    const rows = batch.data as { id: string; object_path: string }[];
    if (rows.length) {
      const removed = await admin.storage
        .from("event-attachments")
        .remove(rows.map((row) => row.object_path));
      if (removed.error) throw removed.error;
      const ack = await admin.rpc("dz_cleanup_ack", {
        p_ids: rows.map((row) => row.id),
      });
      if (ack.error) throw ack.error;
    }
    return Response.json({
      removed: rows.length,
      more_may_remain: rows.length === 100,
    });
  } catch {
    return Response.json(
      {
        error:
          "Maintenance failed; retry is safe. Inspect project function logs.",
      },
      { status: 500 },
    );
  }
});
