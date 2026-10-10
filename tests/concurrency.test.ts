// @vitest-environment node
// Real PostgreSQL 17, independent TCP connections. NOT hosted Supabase/PostgREST.
import { afterAll, beforeAll, expect, it } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { readFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
let server: EmbeddedPostgres;
let admin: Client;
const port = 55439,
  uid = randomUUID(),
  event = randomUUID();
const config = {
  host: "127.0.0.1",
  port,
  user: "postgres",
  password: "isolated-test-only",
  database: "postgres",
};
beforeAll(async () => {
  await mkdir(".cache", { recursive: true });
  server = new EmbeddedPostgres({
    databaseDir: ".cache/concurrency-pg",
    port,
    user: config.user,
    password: config.password,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await server.initialise();
  await server.start();
  admin = new Client(config);
  await admin.connect();
  await admin.query(
    `create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`,
  );
  const source = await readFile(
    "supabase/migrations/20261010010000_phase2_workflow_schema.sql",
    "utf8",
  );
  for (const table of ["rate_rules", "rate_counters"]) {
    const match = source.match(
      new RegExp(`create table public\\.${table} [\\s\\S]*?;`),
    );
    if (!match) throw Error("Missing production schema");
    await admin.query(match[0]);
  }
  const start = source.indexOf("create function public.dz_rate("),
    end = source.indexOf("create function public.dz_blocked", start);
  await admin.query(source.slice(start, end));
  await admin.query("insert into public.rate_rules values('post',3,3600)");
}, 60000);
afterAll(async () => {
  await admin?.end();
  await server?.stop();
}, 30000);
it("allows exactly the configured limit across 12 independent PostgreSQL sessions", async () => {
  const clients = Array.from({ length: 12 }, () => new Client(config));
  await Promise.all(clients.map((c) => c.connect()));
  try {
    const results = await Promise.all(
      clients.map(async (c) => {
        await c.query("begin");
        try {
          await c.query("select set_config('request.jwt.claim.sub',$1,true)", [
            uid,
          ]);
          await c.query("select public.dz_rate($1,$2)", [event, "post"]);
          await c.query("commit");
          return true;
        } catch (e) {
          await c.query("rollback");
          expect(String(e)).toMatch(/Rate limit reached/);
          return false;
        }
      }),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
    const r = await admin.query("select count from public.rate_counters");
    expect(r.rows[0].count).toBe(3);
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
}, 60000);

// Same production authorization functions and relevant tables, without PostGIS.
// Distinct authenticated SQL sessions use a test auth.uid() shim, NOT real JWTs.
const manager = randomUUID(),
  limited = randomUUID(),
  target = randomUUID();
function sqlFunction(sql: string, name: string) {
  const match = sql.match(
    new RegExp(
      `create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`,
    ),
  );
  if (!match) throw Error("Production function not found: " + name);
  return match[0];
}
beforeAll(async () => {
  const base = await readFile(
    "supabase/migrations/20261010000000_phase1_identity_membership_foundation.sql",
    "utf8",
  );
  const schema = await readFile(
    "supabase/migrations/20261010010000_phase2_workflow_schema.sql",
    "utf8",
  );
  const fix = await readFile(
    "supabase/migrations/20261010030000_samartha_acceptance_security.sql",
    "utf8",
  );
  await admin.query(
    "create role authenticated;grant usage on schema auth to authenticated;create table auth.users(id uuid primary key)",
  );
  for (const type of ["event_role", "membership_status", "event_status"])
    await admin.query(
      base.match(new RegExp(`create type public\\.${type} [^;]+;`))![0],
    );
  for (const table of [
    "profiles",
    "events",
    "event_memberships",
    "audit_events",
    "event_invitations",
  ])
    await admin.query(
      base.match(
        new RegExp(`create table public\\.${table} \\([\\s\\S]*?;`),
      )![0],
    );
  for (const name of [
    "is_active_event_member",
    "has_event_permission",
    "write_audit_event",
  ])
    await admin.query(sqlFunction(base, name));
  await admin.query(sqlFunction(schema, "dz_require"));
  await admin.query(
    sqlFunction(base, "manage_event_membership").replace(
      "function public.manage_event_membership",
      "function public.dz_manage_membership_legacy",
    ),
  );
  for (const name of ["manage_event_membership", "revoke_event_membership"])
    await admin.query(sqlFunction(fix, name));
  await admin.query(
    "revoke all on function public.dz_manage_membership_legacy(uuid,uuid,public.event_role,text[]) from public;insert into public.rate_rules values('staff',100,600)",
  );
  await admin.query("insert into auth.users values($1),($2),($3)", [
    manager,
    limited,
    target,
  ]);
  await admin.query(
    "insert into public.events(id,name,slug) values($1,'Isolated native concurrency','isolated-native')",
    [event],
  );
  await admin.query(
    "insert into public.event_memberships(event_id,user_id,role,permissions) values($1,$2,'organizer',array['manage_event','manage_members','manage_roles','grant_organizer']),($1,$3,'organizer',array['manage_members','manage_roles']),($1,$4,'participant','{}')",
    [event, manager, limited, target],
  );
  await admin.query(
    "alter table public.events enable row level security;grant select on public.events to authenticated",
  );
  await admin.query(
    base.match(/create policy events_read_member[\s\S]*?;/)![0],
  );
}, 60000);
it("SAMARTHA: independent authenticated SQL sessions enforce event RLS and committed revocation", async () => {
  const member = new Client(config),
    outsider = new Client(config);
  await member.connect();
  await outsider.connect();
  try {
    for (const [c, id] of [
      [member, target],
      [outsider, uid],
    ] as const) {
      await c.query("set role authenticated");
      await c.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id,
      ]);
    }
    expect(
      (await member.query("select id from public.events")).rows,
    ).toHaveLength(1);
    expect(
      (await outsider.query("select id from public.events")).rows,
    ).toHaveLength(0);
    await admin.query(
      "update public.event_memberships set status='revoked' where event_id=$1 and user_id=$2",
      [event, target],
    );
    expect(
      (await member.query("select id from public.events")).rows,
    ).toHaveLength(0);
  } finally {
    await member.end();
    await outsider.end();
    await admin.query(
      "update public.event_memberships set status='active' where event_id=$1 and user_id=$2",
      [event, target],
    );
  }
});
it("SAMARTHA: a limited revoker cannot race a concurrent organizer grant", async () => {
  const grant = new Client(config),
    revoke = new Client(config);
  await grant.connect();
  await revoke.connect();
  try {
    for (const [c, id] of [
      [grant, manager],
      [revoke, limited],
    ] as const) {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    }
    await grant.query(
      "select public.manage_event_membership($1,$2,'organizer',array['manage_event'])",
      [event, target],
    );
    const pid = (await revoke.query("select pg_backend_pid() pid")).rows[0].pid;
    const result = revoke
      .query("select public.revoke_event_membership($1,$2)", [event, target])
      .then(
        () => ({ error: null }),
        (error) => ({ error }),
      );
    let waiting = false;
    for (let i = 0; i < 100 && !waiting; i++) {
      waiting = (
        await admin.query(
          "select wait_event_type='Lock' waiting from pg_stat_activity where pid=$1",
          [pid],
        )
      ).rows[0]?.waiting;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    await grant.query("commit");
    expect(String((await result).error)).toMatch(/cannot revoke organizer/i);
    await revoke.query("rollback");
    const row = (
      await admin.query(
        "select role,status from public.event_memberships where event_id=$1 and user_id=$2",
        [event, target],
      )
    ).rows[0];
    expect(row).toEqual({ role: "organizer", status: "active" });
  } finally {
    await grant.query("rollback");
    await revoke.query("rollback");
    await grant.end();
    await revoke.end();
  }
}, 30000);
