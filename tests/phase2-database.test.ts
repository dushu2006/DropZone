// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { randomUUID } from "node:crypto";
let db: PGlite;
const user = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = user(1),
  O = user(2),
  Q = user(3),
  M = user(4),
  X = user(5),
  E = user(101),
  F = user(102);
async function as<T>(u: string | null, work: () => Promise<T>) {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${u ? "authenticated" : "anon"}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      u ?? "",
    ]);
    const r = await work();
    await db.exec("commit");
    return r;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
async function cmd(
  u: string,
  e: string,
  a: string,
  d: Record<string, unknown>,
  key = randomUUID(),
) {
  return as(u, async () => {
    const r = await db.query<{ v: any }>(
      "select public.dz_command($1,$2,$3,$4) v",
      [e, a, JSON.stringify(d), key],
    );
    return r.rows[0].v;
  });
}
async function read(
  u: string,
  e: string,
  kind: string,
  f: Record<string, unknown> = {},
) {
  return as(u, async () => {
    const r = await db.query<{ v: any }>("select public.dz_read($1,$2,$3) v", [
      e,
      kind,
      JSON.stringify(f),
    ]);
    return r.rows[0].v;
  });
}
const basic = (extra: Record<string, unknown> = {}) => ({
  category: "community_question",
  title: "Workshop question",
  body: "Where is the workshop?",
  fields: { topic: "schedule" },
  ...extra,
});
beforeAll(async () => {
  db = new PGlite({ extensions: { postgis } });
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create role supabase_auth_admin;create schema auth;grant usage on schema auth to anon,authenticated;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant execute on function auth.uid() to anon,authenticated;
 create schema storage;grant usage on schema storage to authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;grant select,insert on storage.objects to authenticated;`);
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
  for (const [i, name] of [
    [1, "Participant"],
    [2, "Organizer"],
    [3, "Peer"],
    [4, "Report moderator"],
    [5, "Other event member"],
  ] as const)
    await db.query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",
      [user(i), `u${i}@example.test`, JSON.stringify({ display_name: name })],
    );
  await db.query(
    "insert into public.events(id,name,slug) values($1,'First event','first'),($2,'Second event','second')",
    [E, F],
  );
  await db.query(
    `insert into public.event_memberships(event_id,user_id,role,permissions) values($1,$2,'participant','{}'),($1,$3,'organizer',array['manage_event','manage_zones','manage_teams','manage_members','view_members','manage_roles','grant_organizer','grant_moderator','review_reports','review_custom_posts','remove_content','view_audit_log']),($1,$4,'participant','{}'),($1,$5,'moderator',array['review_reports']),($6,$7,'participant','{}')`,
    [E, P, O, Q, M, F, X],
  );
  // High fixture limits isolate workflow assertions; the dedicated rate test sets an exact limit.
  await db.exec("update public.rate_rules set max_requests=1000");
}, 60000);
afterAll(async () => {
  await db?.close();
});
describe("Phase 2 trusted workflows (isolated PostgreSQL, not hosted Supabase)", () => {
  it("enables RLS on every application table and denies anonymous reads/writes", async () => {
    const tables = await db.query<{ rowsecurity: boolean }>(
      "select rowsecurity from pg_tables where schemaname='public'",
    );
    expect(tables.rows.every((r) => r.rowsecurity)).toBe(true);
    await expect(
      as(null, () => db.query("select * from public.posts")),
    ).rejects.toThrow();
    await expect(
      as(P, () =>
        db.query(
          "insert into public.notifications(event_id,user_id,kind,resource_id,title) values($1,$2,'fake',$3,'Fake')",
          [E, P, randomUUID()],
        ),
      ),
    ).rejects.toThrow();
  });
  const fields: Record<string, Record<string, string>> = {
    lost_found: {
      kind: "found",
      item: "Bottle",
      place: "Hall",
      approximate_time: "2026-01-01T10:00:00Z",
      response_preference: "thread_reply",
    },
    find_teammate: { activity: "Workshop", skills: "React", openings: "2" },
    need_resource: { item: "Adapter", quantity: "1", pickup: "Desk" },
    ask_help: { help_category: "Technology", context: "Build failure" },
    offer_resource: {
      offering: "Charger",
      availability: "Today",
      quantity: "2",
    },
    promotion: {
      offer: "Workshop discount",
      valid_until: new Date(Date.now() + 3600000).toISOString(),
    },
    community_question: { topic: "Schedule" },
    custom: { reason: "Unusual format", audience: "Community" },
  };
  for (const [category, values] of Object.entries(fields))
    it(`${category}: validates and persists all structured fields`, async () => {
      const p = await cmd(
        P,
        E,
        "post.create",
        basic({ category, fields: values }),
      );
      expect(p.fields).toEqual(values);
      expect(p.status).toBe(
        ["custom", "promotion"].includes(category)
          ? "awaiting_review"
          : "published",
      );
      const invalid = { ...values };
      delete invalid[Object.keys(invalid)[0]];
      await expect(
        cmd(P, E, "post.create", basic({ category, fields: invalid })),
      ).rejects.toThrow();
      await expect(
        cmd(
          P,
          E,
          "post.create",
          basic({ category, fields: { ...values, unexpected: "discard me" } }),
        ),
      ).rejects.toThrow();
    });
  it("restricts feed, search and category filters to authorized event records", async () => {
    const p = await cmd(
      P,
      E,
      "post.create",
      basic({ title: "Unique telescope resource", body: "Find the telescope" }),
    );
    expect(
      (await read(Q, E, "feed", { search: "telescope" })).map((p: any) => p.id),
    ).toEqual([p.id]);
    expect(await read(X, E, "feed")).toEqual([]);
    expect(
      (await read(Q, E, "feed", { category: "lost_found" })).every(
        (p: any) => p.category === "lost_found",
      ),
    ).toBe(true);
    await expect(cmd(P, F, "post.create", basic())).rejects.toThrow(
      /membership/i,
    );
  });
  it("persists replies, notifications, read state, and idempotent retries", async () => {
    const p = await cmd(P, E, "post.create", basic()),
      key = randomUUID();
    const r = await cmd(
      Q,
      E,
      "reply.create",
      { post_id: p.id, body: "Reply from peer" },
      key,
    );
    expect(
      await cmd(
        Q,
        E,
        "reply.create",
        { post_id: p.id, body: "Reply from peer" },
        key,
      ),
    ).toEqual(r);
    expect(await read(P, E, "replies", { id: p.id })).toHaveLength(1);
    const n = (await read(P, E, "notifications")).find(
      (n: any) => n.resource_id === r.id,
    );
    expect(n.read_at).toBeNull();
    expect(await read(X, E, "notifications")).toEqual([]);
    await cmd(P, E, "notification.read", { id: n.id });
    expect(
      (await read(P, E, "notifications")).find((item: any) => item.id === n.id)
        ?.read_at,
    ).toBeTruthy();
    await expect(
      cmd(Q, E, "notification.read", { id: n.id }),
    ).rejects.toThrow();
    await expect(
      cmd(
        Q,
        E,
        "reply.create",
        { post_id: p.id, body: "Changed payload" },
        key,
      ),
    ).rejects.toThrow(/Retry key/);
  });
  it("distinguishes resolution, expiry and deletion while preserving author history", async () => {
    const p = await cmd(P, E, "post.create", basic());
    await expect(cmd(Q, E, "post.resolve", { id: p.id })).rejects.toThrow();
    await cmd(P, E, "post.resolve", { id: p.id });
    expect((await read(P, E, "feed")).some((x: any) => x.id === p.id)).toBe(
      false,
    );
    expect(
      (await read(P, E, "activity")).find((x: any) => x.id === p.id).status,
    ).toBe("resolved");
    const expired = await cmd(P, E, "post.create", basic());
    await db.query(
      "update public.posts set expires_at=now()-interval '1 minute' where id=$1",
      [expired.id],
    );
    expect(
      (await read(Q, E, "feed")).some((x: any) => x.id === expired.id),
    ).toBe(false);
    await db.exec("select public.dz_maintenance()");
    expect((await read(P, E, "post", { id: expired.id })).status).toBe(
      "expired",
    );
    await cmd(P, E, "post.delete", { id: p.id });
    await db.query(
      "update public.posts set deleted_at=now()-interval '31 days' where id=$1",
      [p.id],
    );
    await db.exec("select public.dz_maintenance()");
    expect((await read(P, E, "post", { id: p.id })).body).toBe(
      "[Deleted content]",
    );
  });
  it("custom revisions cannot self-publish; staff review records an audit decision", async () => {
    const p = await cmd(
      P,
      E,
      "post.create",
      basic({
        category: "custom",
        fields: fields.custom,
        review_mode: "save_submission",
      }),
    );
    expect(p.status).toBe("submitted");
    await cmd(P, E, "post.enqueue", { id: p.id });
    expect((await read(P, E, "post", { id: p.id })).status).toBe(
      "awaiting_review",
    );
    await expect(
      cmd(P, E, "post.review", {
        id: p.id,
        decision: "published",
        reason: "Approve mine",
      }),
    ).rejects.toThrow();
    await expect(
      cmd(M, E, "post.review", {
        id: p.id,
        decision: "published",
        reason: "No review permission",
      }),
    ).rejects.toThrow();
    await cmd(O, E, "post.review", {
      id: p.id,
      decision: "changes_requested",
      reason: "Add relevant context",
    });
    await cmd(
      P,
      E,
      "post.revise",
      basic({
        id: p.id,
        category: "custom",
        fields: fields.custom,
        body: "Revised context included",
      }),
    );
    await cmd(O, E, "post.review", {
      id: p.id,
      decision: "published",
      reason: "Reviewed and approved",
    });
    expect((await read(Q, E, "post", { id: p.id })).status).toBe("published");
    expect(
      (await read(O, E, "audit")).some((a: any) => a.action === "post.review"),
    ).toBe(true);
  });
  it("blocks peer interactions, but mute only suppresses feed and notifications", async () => {
    const p = await cmd(Q, E, "post.create", basic());
    await cmd(P, E, "preference.set", { target_id: Q, muted: true });
    expect((await read(P, E, "feed")).some((x: any) => x.id === p.id)).toBe(
      false,
    );
    expect((await read(P, E, "post", { id: p.id })).id).toBe(p.id);
    await cmd(P, E, "reply.create", {
      post_id: p.id,
      body: "Mute does not block replies",
    });
    await cmd(P, E, "preference.set", { target_id: Q, blocked: true });
    expect(await read(P, E, "post", { id: p.id })).toBeNull();
    await expect(
      cmd(P, E, "reply.create", { post_id: p.id, body: "Blocked" }),
    ).rejects.toThrow();
    await cmd(P, E, "preference.set", { target_id: Q });
  });
  it("reports persist, require a decision permission, and never imply automatic guilt", async () => {
    const p = await cmd(P, E, "post.create", basic()),
      r = await cmd(Q, E, "report.create", {
        target_type: "post",
        target_id: p.id,
        reason: "privacy",
        explanation: "Please review",
      });
    expect((await read(Q, E, "post", { id: p.id })).status).toBe("published");
    expect((await read(M, E, "reports")).some((x: any) => x.id === r.id)).toBe(
      true,
    );
    await expect(
      cmd(Q, E, "report.create", {
        target_type: "post",
        target_id: p.id,
        reason: "spam",
      }),
    ).rejects.toThrow();
    await expect(
      cmd(M, E, "report.decide", {
        id: r.id,
        decision: "removed",
        reason: "No removal grant",
      }),
    ).rejects.toThrow();
    await cmd(O, E, "report.decide", {
      id: r.id,
      decision: "removed",
      reason: "Privacy concern confirmed",
    });
    expect(await read(Q, E, "post", { id: p.id })).toBeNull();
    await expect(
      as(M, () => db.query("update public.audit_events set action='tampered'")),
    ).rejects.toThrow();
  });
  it("organizer conversations are private, paginated and only explicitly marked read", async () => {
    const c = await cmd(P, E, "conversation.create", {
      subject: "Private question",
      body: "Private message",
    });
    expect(await read(Q, E, "messages", { id: c.conversation_id })).toEqual([]);
    expect(await read(X, E, "conversations")).toEqual([]);
    await expect(
      cmd(Q, E, "message.send", {
        conversation_id: c.conversation_id,
        body: "Sneak in",
      }),
    ).rejects.toThrow();
    await cmd(O, E, "message.send", {
      conversation_id: c.conversation_id,
      body: "Organizer response",
    });
    expect(
      await read(P, E, "messages", { id: c.conversation_id }),
    ).toHaveLength(2);
    await cmd(P, E, "conversation.read", { id: c.conversation_id });
    expect((await read(P, E, "conversations"))[0].read_at).toBeTruthy();
  });
  it("creates teams, prevents self assignment and snapshots targeted recipients", async () => {
    const team = await cmd(O, E, "team.save", { name: "Real team" });
    await expect(
      cmd(P, E, "team.assign", { team_id: team.id, user_id: P }),
    ).rejects.toThrow();
    await cmd(O, E, "team.assign", { team_id: team.id, user_id: P });
    await expect(
      cmd(O, E, "team.assign", { team_id: team.id, user_id: X }),
    ).rejects.toThrow();
    const message = await cmd(O, E, "communication.send", {
      kind: "announcement",
      scope: "teams",
      targets: [team.id],
      title: "Team update",
      body: "For one team",
    });
    expect(message.recipients).toBe(1);
    expect(
      (await read(P, E, "communications")).some(
        (c: any) => c.id === message.id,
      ),
    ).toBe(true);
    expect(
      (await read(Q, E, "communications")).some(
        (c: any) => c.id === message.id,
      ),
    ).toBe(false);
    const broadcast = await cmd(O, E, "communication.send", {
      kind: "schedule_update",
      scope: "event",
      title: "All participants",
      body: "Starts at noon",
    });
    expect(broadcast.recipients).toBe(2);
    expect(await read(X, E, "communications")).toEqual([]);
  });
  it("imports transactionally without inventing Auth users, and reports skips/conflicts", async () => {
    const count = (
      await db.query<{ n: number }>("select count(*)::int n from auth.users")
    ).rows[0].n;
    const rows = [
      {
        email: "Roster@Example.test",
        display_name: "Roster only",
        team_name: "Planned team",
      },
    ];
    const result = await cmd(O, E, "roster.import", { rows });
    expect(result).toMatchObject({ imported: 1, skipped: 0, failed: 0 });
    expect(await cmd(O, E, "roster.import", { rows })).toMatchObject({
      imported: 0,
      skipped: 1,
    });
    await expect(
      cmd(O, E, "roster.import", {
        rows: [
          { email: "fresh@example.test", display_name: "Fresh", team_name: "" },
          { ...rows[0], team_name: "Conflict" },
        ],
      }),
    ).rejects.toThrow(/conflict/);
    expect(
      await read(O, E, "roster_preview", {
        rows: [{ ...rows[0], team_name: "Conflict" }],
      }),
    ).not.toEqual([]);
    expect(await read(O, E, "roster_preview", { rows })).toEqual([]);
    await expect(cmd(O, E, "roster.import", {})).rejects.toThrow();
    expect(await read(O, E, "roster")).toHaveLength(1);
    expect(
      (await db.query<{ n: number }>("select count(*)::int n from auth.users"))
        .rows[0].n,
    ).toBe(count);
    await expect(cmd(P, E, "roster.import", { rows })).rejects.toThrow();
    expect(await read(P, E, "roster")).toEqual([]);
  });
  it("validates PostGIS circles, polygons, accuracy and transient posting location", async () => {
    const circle = await cmd(O, E, "zone.save", {
      name: "Center",
      boundary_type: "circle",
      geometry: { type: "Point", coordinates: [79, 19] },
      radius_meters: 100,
    });
    const check = (u: string, lon: number, lat: number, accuracy: number) =>
      as(u, () =>
        db.query<{ v: boolean }>(
          "select public.check_zone_location($1,$2,$3,$4) v",
          [circle.id, lon, lat, accuracy],
        ),
      );
    expect((await check(P, 79, 19, 10)).rows[0].v).toBe(true);
    expect((await check(P, 80, 20, 10)).rows[0].v).toBe(false);
    await expect(check(P, 79, 19, 200)).rejects.toThrow(/accuracy/);
    await expect(check(X, 79, 19, 10)).rejects.toThrow();
    await expect(
      cmd(O, E, "zone.save", {
        name: "Crossed",
        boundary_type: "polygon",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [79, 19],
              [80, 20],
              [80, 19],
              [79, 20],
              [79, 19],
            ],
          ],
        },
      }),
    ).rejects.toThrow();
    await cmd(O, E, "zone.save", {
      name: "Polygon",
      boundary_type: "polygon",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [79, 19],
            [79.01, 19],
            [79.01, 19.01],
            [79, 19.01],
            [79, 19],
          ],
        ],
      },
    });
    await db.query(
      "update public.events set location_required=true where id=$1",
      [E],
    );
    await expect(
      cmd(P, E, "post.create", basic({ insideZone: true })),
    ).rejects.toThrow();
    const key = randomUUID(),
      payload = basic({
        zone_id: circle.id,
        longitude: 79,
        latitude: 19,
        accuracy: 10,
      });
    const p = await cmd(P, E, "post.create", payload, key);
    expect(await cmd(P, E, "post.create", payload, key)).toEqual(p);
    const receipts = await db.query<{ payload: Record<string, unknown> }>(
      "select payload from public.command_receipts where request_id=$1",
      [key],
    );
    expect(receipts.rows[0].payload).not.toHaveProperty("longitude");
    await db.query(
      "update public.events set location_required=false where id=$1",
      [E],
    );
  });
  it("enforces exact private Storage paths and cannot finalize a filename-only upload", async () => {
    const p = await cmd(P, E, "post.create", basic()),
      a = await cmd(P, E, "attachment.reserve", {
        post_id: p.id,
        mime: "image/png",
        size_bytes: 100,
      });
    await expect(
      cmd(P, E, "attachment.finalize", { id: a.id }),
    ).rejects.toThrow(/missing/);
    await expect(
      as(Q, () =>
        db.query(
          "insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)",
          [
            "event-attachments",
            a.object_path,
            { size: 100, mimetype: "image/png" },
          ],
        ),
      ),
    ).rejects.toThrow();
    await as(P, () =>
      db.query(
        "insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)",
        [
          "event-attachments",
          a.object_path,
          { size: 100, mimetype: "image/png" },
        ],
      ),
    );
    await expect(
      cmd(P, E, "attachment.finalize", { id: a.id }),
    ).rejects.toThrow(/verification/);
    await expect(
      as(P, () =>
        db.query("select public.dz_verify_attachment($1,$2)", [a.id, P]),
      ),
    ).rejects.toThrow();
    // Simulate the trusted Edge verifier acknowledgement; actual object bytes are not hosted here.
    await db.query("select public.dz_verify_attachment($1,$2)", [a.id, P]);
    await cmd(P, E, "attachment.finalize", { id: a.id });
    expect(
      (
        await as(X, () =>
          db.query("select * from storage.objects where name=$1", [
            a.object_path,
          ]),
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await as(Q, () =>
          db.query("select * from storage.objects where name=$1", [
            a.object_path,
          ]),
        )
      ).rows,
    ).toHaveLength(1);
    await cmd(P, E, "attachment.delete", { id: a.id });
    const cleanup = await db.query<{ v: { id: string }[] }>(
      "select public.dz_cleanup_batch() v",
    );
    expect(cleanup.rows[0].v.some((x) => x.id === a.id)).toBe(true);
    await expect(
      as(P, () => db.query("select public.dz_cleanup_batch()")),
    ).rejects.toThrow();
    expect(
      (
        await as(Q, () =>
          db.query("select * from storage.objects where name=$1", [
            a.object_path,
          ]),
        )
      ).rows,
    ).toEqual([]);
  });
  it("rate limits repeated calls at the database and rolls back failed-operation notifications", async () => {
    await db.exec(
      "update public.rate_rules set max_requests=2 where action='reply';delete from public.rate_counters where action='reply'",
    );
    const p = await cmd(P, E, "post.create", basic());
    await cmd(Q, E, "reply.create", { post_id: p.id, body: "One" });
    await cmd(Q, E, "reply.create", { post_id: p.id, body: "Two" });
    await expect(
      cmd(Q, E, "reply.create", { post_id: p.id, body: "Three" }),
    ).rejects.toThrow(/Retry in/);
    expect(await read(P, E, "replies", { id: p.id })).toHaveLength(2);
    await db.exec(
      "update public.rate_rules set max_requests=1000 where action='reply'",
    );
  });
  it("serializes overlapping rate-limit requests and creates no notification on a failed reply", async () => {
    await db.exec(
      "update public.rate_rules set max_requests=2 where action='reply';delete from public.rate_counters where action='reply'",
    );
    const p = await cmd(P, E, "post.create", basic());
    // PGlite queues transactions on one connection. This tests overlapping callers, NOT
    // independent PostgreSQL sessions; a hosted multi-connection race remains required.
    const requests = await Promise.allSettled(
      [1, 2, 3, 4].map((i) =>
        db.transaction(async (tx) => {
          await tx.exec("set local role authenticated");
          await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
            Q,
          ]);
          return tx.query("select public.dz_command($1,$2,$3,$4)", [
            E,
            "reply.create",
            JSON.stringify({ post_id: p.id, body: "Concurrent " + i }),
            randomUUID(),
          ]);
        }),
      ),
    );
    expect(requests.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await read(P, E, "replies", { id: p.id })).toHaveLength(2);
    await db.exec(
      "update public.rate_rules set max_requests=1000 where action='reply'",
    );
    const before = (await read(P, E, "notifications")).length;
    await expect(
      cmd(Q, E, "reply.create", { post_id: p.id, body: "" }),
    ).rejects.toThrow();
    expect((await read(P, E, "notifications")).length).toBe(before);
  });
  it("trusted organizers create and reopen events without granting themselves extra permissions", async () => {
    await expect(
      cmd(P, E, "event.create", { name: "Forbidden", slug: "forbidden" }),
    ).rejects.toThrow();
    const e = await cmd(O, E, "event.create", {
      name: "New event",
      slug: "new-event",
    });
    expect(e.id).toBeTruthy();
    await cmd(O, e.id, "event.update", {
      name: "New event",
      status: "archived",
    });
    expect((await read(O, e.id, "overview")).event.status).toBe("archived");
    await cmd(O, e.id, "event.update", { name: "New event", status: "active" });
    expect((await read(O, e.id, "overview")).event.status).toBe("active");
  });
  it("rejects null-radius circles and out-of-range geometry instead of accepting NULL geofence results", async () => {
    await expect(
      cmd(O, E, "zone.save", {
        name: "Missing radius",
        boundary_type: "circle",
        geometry: { type: "Point", coordinates: [79, 19] },
      }),
    ).rejects.toThrow();
    await expect(
      cmd(O, E, "zone.save", {
        name: "Bad coordinates",
        boundary_type: "circle",
        radius_meters: 100,
        geometry: { type: "Point", coordinates: [181, 19] },
      }),
    ).rejects.toThrow();
  });
  it("revoked memberships lose access to content, conversations and teams immediately", async () => {
    await db.query(
      "update public.event_memberships set status='revoked' where user_id=$1 and event_id=$2",
      [Q, E],
    );
    expect(await read(Q, E, "feed")).toEqual([]);
    expect(await read(Q, E, "conversations")).toEqual([]);
    await expect(cmd(Q, E, "post.create", basic())).rejects.toThrow();
  });
});
