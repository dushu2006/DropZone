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
  it("edits published posts with optimistic concurrency and protected revision history", async () => {
    const p = await cmd(P, E, "post.create", basic());
    await expect(
      cmd(
        Q,
        E,
        "post.edit",
        basic({
          id: p.id,
          expected_updated_at: p.updated_at,
          title: "Not mine",
        }),
      ),
    ).rejects.toThrow();
    const edited = await cmd(
      P,
      E,
      "post.edit",
      basic({
        id: p.id,
        expected_updated_at: p.updated_at,
        title: "Edited title",
      }),
    );
    expect(edited.title).toBe("Edited title");
    expect(edited.status).toBe("published");
    expect(edited.expires_at).toBe(p.expires_at);
    await expect(
      cmd(
        P,
        E,
        "post.edit",
        basic({
          id: p.id,
          expected_updated_at: p.updated_at,
          title: "Stale edit",
        }),
      ),
    ).rejects.toThrow(/changed/);
    expect((await read(P, E, "revisions", { id: p.id }))[0].title).toBe(
      p.title,
    );
    expect(await read(Q, E, "revisions", { id: p.id })).toEqual([]);
    await cmd(P, E, "post.delete", { id: p.id });
    await db.query(
      "update public.posts set deleted_at=now()-interval '31 days' where id=$1",
      [p.id],
    );
    await db.exec("select public.dz_maintenance()");
    expect(
      (await read(P, E, "revisions", { id: p.id })).every(
        (r: any) => r.body === "[Content retention period ended]",
      ),
    ).toBe(true);
  });
  it("published reviewed content returns to review when edited, and rejection reasons persist", async () => {
    const p = await cmd(
      P,
      E,
      "post.create",
      basic({ category: "custom", fields: fields.custom }),
    );
    await cmd(O, E, "post.review", {
      id: p.id,
      decision: "published",
      reason: "Reviewed content",
    });
    const approved = await read(P, E, "post", { id: p.id });
    expect(approved.reviewed_at).toBeTruthy();
    const edited = await cmd(
      P,
      E,
      "post.edit",
      basic({
        id: p.id,
        category: "custom",
        fields: fields.custom,
        body: "New content needs another review",
        expected_updated_at: approved.updated_at,
      }),
    );
    expect(edited.status).toBe("awaiting_review");
    expect(edited.reviewed_at).toBeNull();
    expect(await read(Q, E, "post", { id: p.id })).toBeNull();
    await cmd(O, E, "post.review", {
      id: p.id,
      decision: "rejected",
      reason: "Outside community scope",
    });
    expect((await read(P, E, "post", { id: p.id })).decision_reason).toBe(
      "Outside community scope",
    );
  });
  it("blocks replies to an inaccessible parent, including direct guessed IDs", async () => {
    const p = await cmd(O, E, "post.create", basic());
    const r = await cmd(Q, E, "reply.create", {
      post_id: p.id,
      body: "Peer reply",
    });
    await cmd(P, E, "preference.set", { target_id: Q, blocked: true });
    await expect(
      cmd(P, E, "reply.create", {
        post_id: p.id,
        parent_id: r.id,
        body: "Try blocked parent",
      }),
    ).rejects.toThrow(/Parent reply/);
    await expect(
      cmd(P, E, "report.create", {
        target_type: "reply",
        target_id: r.id,
        reason: "spam",
      }),
    ).rejects.toThrow();
    await cmd(P, E, "preference.set", { target_id: Q });
  });
  it("does not allow a limited role manager to demote an organizer", async () => {
    await db.query(
      "update public.event_memberships set role='organizer',permissions=array['manage_roles','manage_members'] where event_id=$1 and user_id=$2",
      [E, Q],
    );
    try {
      await expect(
        as(Q, () =>
          db.query(
            "select public.manage_event_membership($1,$2,'participant','{}')",
            [E, O],
          ),
        ),
      ).rejects.toThrow(/staff role/);
    } finally {
      await db.query(
        "update public.event_memberships set role='participant',permissions='{}' where event_id=$1 and user_id=$2",
        [E, Q],
      );
    }
    expect(
      (await read(O, E, "overview")).memberships.find(
        (m: any) => m.user_id === O,
      ).role,
    ).toBe("organizer");
  });
  it("shows moderation reasons to the affected user without revealing reporter identity", async () => {
    const r = await cmd(Q, E, "report.create", {
      target_type: "user",
      target_id: P,
      reason: "harassment",
    });
    await cmd(M, E, "report.decide", {
      id: r.id,
      decision: "escalated",
      reason: "Needs authorized restriction review",
    });
    await cmd(O, E, "report.decide", {
      id: r.id,
      decision: "restricted",
      reason: "Repeated interactions temporarily restricted",
    });
    const safety = await read(P, E, "safety");
    expect(
      safety.decisions.at(-1)?.reason ?? safety.decisions[0].reason,
    ).toBeTruthy();
    expect(safety.decisions.some((d: any) => d.decision === "restricted")).toBe(
      true,
    );
    expect(safety.decisions.every((d: any) => !d.reporter_id)).toBe(true);
    await expect(cmd(P, E, "post.create", basic())).rejects.toThrow(
      /restricted/,
    );
    await db.query(
      "delete from public.user_restrictions where event_id=$1 and user_id=$2",
      [E, P],
    );
  });
  it("supports individual and multi-team recipient snapshots without duplicate notifications", async () => {
    const a = await cmd(O, E, "team.save", { name: "Multi A" }),
      b = await cmd(O, E, "team.save", { name: "Multi B" });
    await cmd(O, E, "team.assign", { user_id: P, team_id: a.id });
    await cmd(O, E, "team.assign", { user_id: Q, team_id: b.id });
    const m = await cmd(O, E, "communication.send", {
      kind: "contact",
      scope: "teams",
      targets: [a.id, b.id, a.id],
      title: "Multi team",
      body: "Both selected teams",
    });
    expect(m.recipients).toBe(2);
    const direct = await cmd(O, E, "communication.send", {
      kind: "contact",
      scope: "participant",
      targets: [P],
      title: "Private contact",
      body: "Single recipient",
    });
    expect(direct.recipients).toBe(1);
    expect(
      (await read(Q, E, "communications")).some((c: any) => c.id === direct.id),
    ).toBe(false);
    await expect(
      cmd(O, E, "communication.send", {
        kind: "contact",
        scope: "participant",
        targets: [X],
        title: "Wrong event",
        body: "Denied",
      }),
    ).rejects.toThrow();
  });
  it("keyset feed pages remain stable when new posts are inserted", async () => {
    await db.exec(
      "update public.rate_rules set max_requests=1000 where action='post'",
    );
    for (let i = 0; i < 32; i++)
      await cmd(P, E, "post.create", basic({ title: "Cursor fixture " + i }));
    const first = await read(P, E, "feed", { search: "Cursor" });
    expect(first).toHaveLength(30);
    const last = first[first.length - 1];
    await cmd(P, E, "post.create", basic({ title: "Cursor fixture new" }));
    const second = await read(P, E, "feed", {
      search: "Cursor",
      before_time: last.created_at,
      before_id: last.id,
    });
    expect(second).toHaveLength(2);
    expect(second.some((p: any) => first.some((f: any) => f.id === p.id))).toBe(
      false,
    );
  });
  it("resumes completed attachment finalization and denies access after revocation", async () => {
    const p = await cmd(Q, E, "post.create", basic());
    const a = await cmd(Q, E, "attachment.reserve", {
      post_id: p.id,
      mime: "image/png",
      size_bytes: 100,
    });
    await as(Q, () =>
      db.query(
        "insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)",
        [
          "event-attachments",
          a.object_path,
          { size: 100, mimetype: "image/png" },
        ],
      ),
    );
    await db.query("select public.dz_verify_attachment($1,$2)", [a.id, Q]);
    await cmd(Q, E, "attachment.finalize", { id: a.id });
    expect((await cmd(Q, E, "attachment.finalize", { id: a.id })).status).toBe(
      "ready",
    );
    await db.query(
      "update public.event_memberships set status='revoked' where event_id=$1 and user_id=$2",
      [E, Q],
    );
    expect(
      (
        await as(Q, () =>
          db.query("select * from storage.objects where name=$1", [
            a.object_path,
          ]),
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await db.query(
          "select * from public.team_memberships where event_id=$1 and user_id=$2",
          [E, Q],
        )
      ).rows,
    ).toEqual([]);
    await db.query(
      "update public.event_memberships set status='active' where event_id=$1 and user_id=$2",
      [E, Q],
    );
  });
  it("updates only the authenticated profile and never role grants", async () => {
    await as(P, () =>
      db.query("select public.update_my_profile($1)", ["Updated display name"]),
    );
    expect((await read(P, E, "overview")).memberships[0].role).toBe(
      "participant",
    );
    const profile = await as(P, () =>
      db.query<{ display_name: string }>(
        "select display_name from public.profiles",
      ),
    );
    expect(profile.rows[0].display_name).toBe("Updated display name");
    await expect(
      as(null, () => db.query("select public.update_my_profile($1)", ["Anon"])),
    ).rejects.toThrow();
  });
  it("enforces category-specific promotion, post, report and message limits in the database", async () => {
    const attempts: [string, string, Record<string, unknown>][] = [
      ["post", "post.create", basic()],
      [
        "promotion",
        "post.create",
        basic({ category: "promotion", fields: fields.promotion }),
      ],
      [
        "custom",
        "post.create",
        basic({ category: "custom", fields: fields.custom }),
      ],
      [
        "message",
        "conversation.create",
        { subject: "Rate test", body: "Message" },
      ],
    ];
    for (const [rule, action, payload] of attempts) {
      await db.query(
        "update public.rate_rules set max_requests=1 where action=$1",
        [rule],
      );
      await db.query(
        "delete from public.rate_counters where user_id=$1 and action=$2",
        [P, rule],
      );
      try {
        await cmd(P, E, action, payload);
        await expect(cmd(P, E, action, payload)).rejects.toThrow(/Retry in/);
      } finally {
        await db.query(
          "update public.rate_rules set max_requests=1000 where action=$1",
          [rule],
        );
      }
    }
    await db.exec(
      "update public.rate_rules set max_requests=1 where action='report';delete from public.rate_counters where action='report'",
    );
    const p = await cmd(O, E, "post.create", basic()),
      q = await cmd(O, E, "post.create", basic());
    await cmd(P, E, "report.create", {
      target_type: "post",
      target_id: p.id,
      reason: "other",
    });
    await expect(
      cmd(P, E, "report.create", {
        target_type: "post",
        target_id: q.id,
        reason: "other",
      }),
    ).rejects.toThrow(/Retry in/);
    await db.exec(
      "update public.rate_rules set max_requests=1000 where action='report'",
    );
  });
  it("edits saved circle and polygon geometry through the permission-checked operation", async () => {
    const circle = await cmd(O, E, "zone.save", {
      name: "Editable circle",
      boundary_type: "circle",
      geometry: { type: "Point", coordinates: [79, 19] },
      radius_meters: 100,
    });
    await cmd(O, E, "zone.save", {
      id: circle.id,
      name: "Editable circle",
      boundary_type: "circle",
      geometry: { type: "Point", coordinates: [79.001, 19] },
      radius_meters: 200,
    });
    const polygon = await cmd(O, E, "zone.save", {
      name: "Editable polygon",
      boundary_type: "polygon",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [79, 19],
            [79.01, 19],
            [79.01, 19.01],
            [79, 19],
          ],
        ],
      },
    });
    await cmd(O, E, "zone.save", {
      id: polygon.id,
      name: "Edited polygon",
      boundary_type: "polygon",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [79, 19],
            [79.02, 19],
            [79.02, 19.02],
            [79, 19],
          ],
        ],
      },
    });
    const zones = (await read(P, E, "overview")).zones;
    expect(zones.find((z: any) => z.id === circle.id).radius_meters).toBe(200);
    expect(zones.find((z: any) => z.id === polygon.id).name).toBe(
      "Edited polygon",
    );
    await expect(
      cmd(P, E, "zone.save", {
        id: circle.id,
        name: "Forbidden",
        boundary_type: "circle",
        geometry: { type: "Point", coordinates: [79, 19] },
        radius_meters: 50,
      }),
    ).rejects.toThrow();
  });
  it("requeues reviewed posts when newly uploaded bytes change their content", async () => {
    const p = await cmd(
      Q,
      E,
      "post.create",
      basic({ category: "custom", fields: fields.custom }),
    );
    await cmd(O, E, "post.review", {
      id: p.id,
      decision: "published",
      reason: "Reviewed text",
    });
    const a = await cmd(Q, E, "attachment.reserve", {
      post_id: p.id,
      mime: "image/png",
      size_bytes: 100,
    });
    await as(Q, () =>
      db.query(
        "insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)",
        [
          "event-attachments",
          a.object_path,
          { size: 100, mimetype: "image/png" },
        ],
      ),
    );
    await db.query("select public.dz_verify_attachment($1,$2)", [a.id, Q]);
    await cmd(Q, E, "attachment.finalize", { id: a.id });
    expect((await read(Q, E, "post", { id: p.id })).status).toBe(
      "awaiting_review",
    );
    expect(await read(P, E, "post", { id: p.id })).toBeNull();
  });
  it("evaluates polygon containment server-side without retaining supplied GPS coordinates", async () => {
    const z = (await read(P, E, "overview")).zones.find(
      (z: any) => z.name === "Edited polygon",
    );
    await cmd(O, E, "event.update", {
      name: "Primary event",
      status: "active",
      max_accuracy_meters: 100,
      downloads_allowed: true,
      location_required: true,
    });
    try {
      const p = await cmd(
        P,
        E,
        "post.create",
        basic({
          zone_id: z.id,
          longitude: 79.003,
          latitude: 19.001,
          accuracy: 20,
        }),
      );
      expect(p.zone_id).toBe(z.id);
      expect(p.longitude).toBeUndefined();
      expect(p.latitude).toBeUndefined();
      await expect(
        cmd(
          P,
          E,
          "post.create",
          basic({ zone_id: z.id, longitude: 80, latitude: 20, accuracy: 20 }),
        ),
      ).rejects.toThrow(/inside the selected event zone/);
    } finally {
      await cmd(O, E, "event.update", {
        name: "Primary event",
        status: "active",
        max_accuracy_meters: 100,
        downloads_allowed: true,
        location_required: false,
      });
    }
  });
  it("rechecks current staff permission before replaying a successful retry receipt", async () => {
    const key = randomUUID(),
      payload = { name: "Receipt authority fixture" };
    await cmd(O, E, "team.save", payload, key);
    const original = (
      await db.query<{ permissions: string[] }>(
        "select permissions from public.event_memberships where event_id=$1 and user_id=$2",
        [E, O],
      )
    ).rows[0].permissions;
    await db.query(
      "update public.event_memberships set permissions=array_remove(permissions,'manage_teams') where event_id=$1 and user_id=$2",
      [E, O],
    );
    try {
      await expect(cmd(O, E, "team.save", payload, key)).rejects.toThrow(
        /Required event permission/,
      );
    } finally {
      await db.query(
        "update public.event_memberships set permissions=$3 where event_id=$1 and user_id=$2",
        [E, O, original],
      );
    }
  });
  it("SAMARTHA: invitation, upload and staff operations enforce their own backend limits", async () => {
    for (const rule of ["invitation", "upload", "staff"]) {
      await db.query(
        "update public.rate_rules set max_requests=1 where action=$1",
        [rule],
      );
      await db.query("delete from public.rate_counters where action=$1", [
        rule,
      ]);
      try {
        const operation =
          rule === "invitation"
            ? () =>
                as(O, () =>
                  db.query("select public.create_event_invitation($1,$2)", [
                    E,
                    "native-audit-invitation-" +
                      randomUUID().replaceAll("-", ""),
                  ]),
                )
            : rule === "upload"
              ? async () => {
                  const p = await cmd(P, E, "post.create", basic());
                  return cmd(P, E, "attachment.reserve", {
                    post_id: p.id,
                    mime: "image/png",
                    size_bytes: 100,
                  });
                }
              : () =>
                  cmd(O, E, "team.save", { name: "Rate test " + randomUUID() });
        await operation();
        await expect(operation()).rejects.toThrow(/Rate limit reached/);
      } finally {
        await db.query(
          "update public.rate_rules set max_requests=1000 where action=$1",
          [rule],
        );
      }
    }
  });
  it("SAMARTHA: message pagination remains private across page boundaries", async () => {
    const c = await cmd(P, E, "conversation.create", {
      subject: "Pagination audit",
      body: "First message",
    });
    for (let i = 1; i < 52; i++)
      await cmd(P, E, "message.send", {
        conversation_id: c.conversation_id,
        body: "Isolated message " + i,
      });
    const first = await read(P, E, "messages", { id: c.conversation_id }),
      second = await read(P, E, "messages", {
        id: c.conversation_id,
        offset: 50,
      });
    expect(first).toHaveLength(50);
    expect(second).toHaveLength(2);
    expect(second.some((r: any) => first.some((x: any) => x.id === r.id))).toBe(
      false,
    );
    expect(
      await read(Q, E, "messages", { id: c.conversation_id, offset: 50 }),
    ).toEqual([]);
  });
  it("SAMARTHA: archived retention removes private records and stale operational data but preserves audit", async () => {
    const event = await cmd(O, E, "event.create", {
      name: "Isolated retention audit",
      slug: "isolated-retention-audit",
      description: "Test only",
    });
    await as(O, () =>
      db.query(
        "select public.manage_event_membership($1,$2,'participant','{}')",
        [event.id, P],
      ),
    );
    const p = await cmd(P, event.id, "post.create", basic());
    await cmd(O, event.id, "reply.create", {
      post_id: p.id,
      body: "Retention reply",
    });
    const c = await cmd(P, event.id, "conversation.create", {
      subject: "Private retention test",
      body: "Private retained body",
    });
    await cmd(P, event.id, "conversation.read", { id: c.conversation_id });
    await cmd(O, event.id, "roster.import", {
      rows: [
        {
          email: "retention@example.test",
          display_name: "Isolated record",
          team_name: "",
        },
      ],
    });
    const a = await cmd(P, event.id, "attachment.reserve", {
      post_id: p.id,
      mime: "image/png",
      size_bytes: 100,
    });
    await db.query(
      "update public.command_receipts set created_at=now()-interval '8 days' where event_id=$1",
      [event.id],
    );
    await db.query(
      "update public.notifications set created_at=now()-interval '91 days' where event_id=$1",
      [event.id],
    );
    await db.query(
      "update public.rate_counters set window_start=now()-interval '3 days' where event_id=$1",
      [event.id],
    );
    await db.query(
      "update public.events set status='archived',archived_at=now()-interval '181 days' where id=$1",
      [event.id],
    );
    await db.exec("select public.dz_maintenance()");
    for (const table of [
      "messages",
      "conversations",
      "roster_records",
      "roster_imports",
      "command_receipts",
      "rate_counters",
      "notifications",
    ])
      expect(
        (
          await db.query(`select * from public.${table} where event_id=$1`, [
            event.id,
          ])
        ).rows,
      ).toEqual([]);
    expect(
      (
        await db.query<{ body: string }>(
          "select body from public.posts where id=$1",
          [p.id],
        )
      ).rows[0].body,
    ).toBe("[Content retention period ended]");
    expect(
      (
        await db.query<{ status: string }>(
          "select status from public.attachments where id=$1",
          [a.id],
        )
      ).rows[0].status,
    ).toBe("deleted");
    expect(
      (
        await db.query("select id from public.audit_events where event_id=$1", [
          event.id,
        ])
      ).rows.length,
    ).toBeGreaterThan(0);
    expect(
      (
        await db.query(
          "select * from public.conversation_reads where conversation_id=$1",
          [c.conversation_id],
        )
      ).rows,
    ).toEqual([]);
  });
  it("SAMARTHA: rejected submissions can be revised without self-publication or lost reasons", async () => {
    const p = await cmd(
      P,
      E,
      "post.create",
      basic({ category: "custom", fields: { reason: "Review resubmission" } }),
    );
    await cmd(O, E, "post.review", {
      id: p.id,
      decision: "rejected",
      reason: "Please remove off-topic material",
    });
    await expect(
      cmd(
        Q,
        E,
        "post.revise",
        basic({
          id: p.id,
          category: "custom",
          fields: { reason: "Peer tampering" },
        }),
      ),
    ).rejects.toThrow();
    const revised = await cmd(
      P,
      E,
      "post.revise",
      basic({
        id: p.id,
        category: "custom",
        fields: { reason: "Corrected topic" },
        body: "Corrected, still requiring staff review",
      }),
    );
    expect(revised.status).toBe("awaiting_review");
    expect(revised.expires_at).toBe(p.expires_at);
    expect(await read(Q, E, "post", { id: p.id })).toBeNull();
    expect(
      (await read(P, E, "revisions", { id: p.id })).some(
        (r: any) => r.decision_reason === "Please remove off-topic material",
      ),
    ).toBe(true);
    await cmd(O, E, "post.review", {
      id: p.id,
      decision: "rejected",
      reason: "Second private reason",
    });
    await cmd(P, E, "post.delete", { id: p.id });
    await db.query(
      "update public.posts set deleted_at=now()-interval '31 days' where id=$1",
      [p.id],
    );
    await db.exec("select public.dz_maintenance()");
    expect(
      (
        await db.query("select decision_reason from public.posts where id=$1", [
          p.id,
        ])
      ).rows[0].decision_reason,
    ).toBeNull();
    expect(
      (
        await db.query(
          "select decision_reason from public.post_revisions where post_id=$1 and decision_reason is not null",
          [p.id],
        )
      ).rows,
    ).toEqual([]);
  });
  it("SAMARTHA: expiry never publishes unapproved custom text or attachments", async () => {
    const p = await cmd(
      P,
      E,
      "post.create",
      basic({ category: "custom", fields: { reason: "Needs private review" } }),
    );
    const a = await cmd(P, E, "attachment.reserve", {
      post_id: p.id,
      mime: "image/png",
      size_bytes: 100,
    });
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
    await db.query("select public.dz_verify_attachment($1,$2)", [a.id, P]);
    await cmd(P, E, "attachment.finalize", { id: a.id });
    expect(await read(Q, E, "post", { id: p.id })).toBeNull();
    await db.query(
      "update public.posts set expires_at=now()-interval '1 second' where id=$1",
      [p.id],
    );
    await db.exec("select public.dz_maintenance()");
    expect((await read(P, E, "post", { id: p.id })).status).toBe("expired");
    expect(await read(Q, E, "post", { id: p.id })).toBeNull();
    expect(
      (
        await as(Q, () =>
          db.query("select id from public.posts where id=$1", [p.id]),
        )
      ).rows,
    ).toEqual([]);
    expect(await read(Q, E, "attachments", { id: p.id })).toEqual([]);
    expect(
      (
        await as(Q, () =>
          db.query("select id from storage.objects where name=$1", [
            a.object_path,
          ]),
        )
      ).rows,
    ).toEqual([]);
    expect((await read(O, E, "post", { id: p.id })).id).toBe(p.id);
  });
  it("SAMARTHA: expiry preserves approval boundaries for every pending state and edited version", async () => {
    for (const category of ["custom", "promotion"])
      for (const state of ["submitted", "changes_requested", "edited"]) {
        const fields =
          category === "custom"
            ? { reason: "Private submission" }
            : {
                offer: "Test offer",
                valid_until: new Date(Date.now() + 86400000).toISOString(),
              };
        const p = await cmd(
          P,
          E,
          "post.create",
          basic({
            category,
            fields,
            ...(state === "submitted"
              ? { review_mode: "save_submission" }
              : {}),
          }),
        );
        if (state === "changes_requested")
          await cmd(O, E, "post.review", {
            id: p.id,
            decision: "changes_requested",
            reason: "Please revise scope",
          });
        if (state === "edited") {
          await cmd(O, E, "post.review", {
            id: p.id,
            decision: "published",
            reason: "Approved first version",
          });
          const prior = await read(P, E, "post", { id: p.id });
          expect((await read(Q, E, "post", { id: p.id })).id).toBe(p.id);
          await cmd(
            P,
            E,
            "post.edit",
            basic({
              id: p.id,
              category,
              fields,
              body: "Unreviewed replacement",
              expected_updated_at: prior.updated_at,
            }),
          );
        }
        await db.query(
          "update public.posts set expires_at=now()-interval '1 second' where id=$1",
          [p.id],
        );
        await db.exec("select public.dz_maintenance()");
        expect(await read(Q, E, "post", { id: p.id })).toBeNull();
        expect((await read(P, E, "post", { id: p.id })).effective_status).toBe(
          "expired",
        );
      }
    const approved = await cmd(
      P,
      E,
      "post.create",
      basic({ category: "custom", fields: { reason: "Approved archive" } }),
    );
    await cmd(O, E, "post.review", {
      id: approved.id,
      decision: "published",
      reason: "Approved current version",
    });
    await db.query(
      "update public.posts set expires_at=now()-interval '1 second' where id=$1",
      [approved.id],
    );
    await db.exec("select public.dz_maintenance()");
    expect((await read(Q, E, "post", { id: approved.id })).status).toBe(
      "expired",
    );
    await expect(
      as(P, () =>
        db.query(
          "update public.posts set publication_authorized=true where id=$1",
          [approved.id],
        ),
      ),
    ).rejects.toThrow();
  });
  it("SAMARTHA: an old invitation cannot reactivate a revoked member", async () => {
    const token =
      "samartha-isolated-invitation-" + randomUUID().replaceAll("-", "");
    await as(O, () =>
      db.query(
        "select public.create_event_invitation($1,$2,now()+interval '1 day',10)",
        [E, token],
      ),
    );
    await as(O, () =>
      db.query("select public.revoke_event_membership($1,$2)", [E, Q]),
    );
    try {
      await expect(
        as(Q, () =>
          db.query("select public.accept_event_invitation($1)", [token]),
        ),
      ).rejects.toThrow(/revoked|restore/i);
      expect(
        (
          await db.query<{ status: string }>(
            "select status from public.event_memberships where event_id=$1 and user_id=$2",
            [E, Q],
          )
        ).rows[0].status,
      ).toBe("revoked");
      expect(
        (
          await db.query<{ use_count: number }>(
            "select use_count from public.event_invitations where token_hash=sha256(convert_to($1,'UTF8'))",
            [token],
          )
        ).rows[0].use_count,
      ).toBe(0);
      await as(O, () =>
        db.query(
          "select public.manage_event_membership($1,$2,'participant','{}')",
          [E, Q],
        ),
      );
      expect((await read(Q, E, "overview")).event.id).toBe(E);
    } finally {
      await db.query(
        "update public.event_memberships set status='active' where event_id=$1 and user_id=$2",
        [E, Q],
      );
    }
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
