// Opt-in, MUTATING staging integration smoke. Never runs with ordinary npm test.
// Use confirmed test users' short-lived access tokens in an ignored local env file.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const names = [
  "DZ_STAGING_URL",
  "DZ_STAGING_PUBLISHABLE_KEY",
  "DZ_STAGING_EVENT_ID",
  "DZ_PARTICIPANT_TOKEN",
  "DZ_PEER_TOKEN",
  "DZ_OUTSIDER_TOKEN",
];
const missing = names.filter((k) => !process.env[k]);
if (missing.length || process.env.DZ_ALLOW_STAGING_WRITES !== "YES") {
  console.error(
    "BLOCKED: explicit staging write consent and configuration required. See docs/DEPLOYMENT.md. Missing: " +
      missing.join(", "),
  );
  process.exit(2);
}
const env = process.env,
  url = new URL(env.DZ_STAGING_URL);
assert(url.protocol === "https:", "Use a dedicated HTTPS staging project");
const publicKey = env.DZ_STAGING_PUBLISHABLE_KEY;
assert(
  publicKey.startsWith("sb_publishable_") ||
    (publicKey.startsWith("eyJ") &&
      JSON.parse(Buffer.from(publicKey.split(".")[1], "base64url")).role ===
        "anon"),
  "Only browser-safe publishable or legacy anon keys are accepted",
);
function client(token) {
  return createClient(url.origin, env.DZ_STAGING_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
const author = client(env.DZ_PARTICIPANT_TOKEN),
  peer = client(env.DZ_PEER_TOKEN),
  outsider = client(env.DZ_OUTSIDER_TOKEN);
const e = env.DZ_STAGING_EVENT_ID;
async function rpc(c, name, args) {
  const { data, error } = await c.rpc(name, args);
  if (error) throw new Error(name + ": " + error.message);
  return data;
}
const command = (c, action, data, key = randomUUID()) =>
  rpc(c, "dz_command", {
    p_event: e,
    p_action: action,
    p_data: data,
    p_request: key,
  });
const read = (c, kind, filter = {}) =>
  rpc(c, "dz_read", { p_event: e, p_kind: kind, p_filter: filter });
function assertStorageDenied(result, message) {
  assert(
    result.error &&
      ["400", "401", "403", "404"].includes(
        String(result.error.statusCode ?? result.error.status),
      ),
    message + "; network/5xx errors do not count as authorization evidence",
  );
}
let post, attachment;
try {
  const identities = await Promise.all(
    [
      [author, env.DZ_PARTICIPANT_TOKEN],
      [peer, env.DZ_PEER_TOKEN],
      [outsider, env.DZ_OUTSIDER_TOKEN],
    ].map(async ([c, token]) => {
      const { data, error } = await c.auth.getUser(token);
      assert(
        !error && data.user,
        "Access token must identify a confirmed staging user",
      );
      return data.user.id;
    }),
  );
  assert(
    new Set(identities).size === 3,
    "Use three independent accounts, not three sessions of the same account",
  );
  const own = await rpc(author, "get_my_access", {}),
    other = await rpc(outsider, "get_my_access", {});
  assert(
    own.memberships.some((m) => m.event_id === e && m.role === "participant"),
    "Author must be an active participant",
  );
  assert(
    !other.memberships.some((m) => m.event_id === e),
    "Outsider must have no target event membership",
  );
  const overview = await read(author, "overview");
  assert(
    !overview.event.location_required,
    "Use a staging event with location checks disabled; GPS verification is separate",
  );
  const payload = {
    category: "ask_help",
    title: "Staging verification " + randomUUID().slice(0, 8),
    body: "Disposable integration test, not production activity.",
    fields: { help_category: "Verification" },
  };
  const key = randomUUID();
  post = await command(author, "post.create", payload, key);
  assert.equal(
    (await command(author, "post.create", payload, key)).id,
    post.id,
    "Retry must not duplicate a post",
  );
  assert.equal((await read(peer, "post", { id: post.id })).id, post.id);
  const denied = await outsider.rpc("dz_read", {
    p_event: e,
    p_kind: "post",
    p_filter: { id: post.id },
  });
  assert(
    denied.error?.code === "42501" || (!denied.error && denied.data === null),
    "Outsider must not see the post",
  );
  const direct = await outsider.from("posts").select("id").eq("id", post.id);
  assert(
    !direct.error && Array.isArray(direct.data) && direct.data.length === 0,
    "Direct REST RLS must return an empty authorized result, not a network/server failure",
  );
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMIqEj5DwAEdAIsaPTzigAAAABJRU5ErkJggg==",
    "base64",
  );
  attachment = await command(author, "attachment.reserve", {
    post_id: post.id,
    mime: "image/png",
    size_bytes: bytes.length,
  });
  const upload = await author.storage
    .from("event-attachments")
    .upload(attachment.object_path, bytes, {
      contentType: "image/png",
      upsert: false,
    });
  assert(!upload.error, "Private byte upload failed");
  const verify = await author.functions.invoke("verify-attachment", {
    body: { event_id: e, post_id: post.id, attachment_id: attachment.id },
  });
  assert(
    !verify.error && verify.data?.verified,
    "Deployed Edge verification failed",
  );
  await command(author, "attachment.finalize", { id: attachment.id });
  const download = await peer.storage
    .from("event-attachments")
    .download(attachment.object_path);
  assert(
    !download.error && download.data,
    "Authorized private download failed",
  );
  assert.deepEqual(Buffer.from(await download.data.arrayBuffer()), bytes);
  const noDownload = await outsider.storage
    .from("event-attachments")
    .download(attachment.object_path);
  assertStorageDenied(noDownload, "Outsider must not fetch private bytes");
  await command(author, "attachment.delete", { id: attachment.id });
  assertStorageDenied(
    await peer.storage
      .from("event-attachments")
      .download(attachment.object_path),
    "Tombstoned file must no longer be fetchable",
  );
  console.log(
    "PASS: real independent Auth identities, RPC persistence/idempotency, direct REST event RLS, private Storage bytes, deployed verifier, authorized download and tombstone denial. Other release scenarios remain mandatory.",
  );
} finally {
  if (post) {
    try {
      await command(author, "post.delete", { id: post.id });
      console.log(
        "Staging post tombstoned. Operator must verify scheduled retention/object cleanup.",
      );
    } catch {
      console.error(
        "Cleanup incomplete: inspect staging verification posts in My activity; no service role or destructive reset was used.",
      );
      process.exitCode = 1;
    }
  }
}
