import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { imageMime } from "../_shared/image.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!,
      anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authorization = req.headers.get("Authorization") ?? "";
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const {
      data: { user },
      error: authError,
    } = await caller.auth.getUser();
    if (authError || !user) return json({ error: "Sign in required." }, 401);
    const { event_id, post_id, attachment_id } = await req.json();
    const { data: attachments, error } = await caller.rpc("dz_read", {
      p_event: event_id,
      p_kind: "attachments",
      p_filter: { id: post_id },
    });
    if (error) return json({ error: "Attachment access denied." }, 403);
    const attachment = attachments?.find(
      (row: { id: string; owner_id: string; status: string }) =>
        row.id === attachment_id &&
        row.owner_id === user.id &&
        row.status === "pending",
    );
    if (!attachment) return json({ error: "Pending upload not found." }, 403);
    const admin = createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data: file, error: downloadError } = await admin.storage
      .from("event-attachments")
      .download(attachment.object_path);
    if (downloadError || !file)
      return json(
        { error: "Uploaded object is unavailable. Retry the upload." },
        409,
      );
    if (
      file.size !== attachment.size_bytes ||
      file.size > 5242880 ||
      imageMime(new Uint8Array(await file.slice(0, 12).arrayBuffer())) !==
        attachment.mime
    ) {
      return json(
        {
          error:
            "The uploaded bytes do not match an allowed image format and reserved size.",
        },
        422,
      );
    }
    const verified = await admin.rpc("dz_verify_attachment", {
      p_id: attachment.id,
      p_owner: user.id,
    });
    if (verified.error)
      return json(
        { error: "Upload eligibility changed. Refresh your event access." },
        409,
      );
    return json({ verified: true });
  } catch {
    return json(
      {
        error:
          "Image verification could not complete. Retry without changing the uploaded file.",
      },
      500,
    );
  }
});
