// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'

const USER_PARTICIPANT = '00000000-0000-4000-8000-000000000001'
const USER_ORGANIZER = '00000000-0000-4000-8000-000000000002'
const USER_MODERATOR = '00000000-0000-4000-8000-000000000003'
const USER_NO_MEMBERSHIP = '00000000-0000-4000-8000-000000000004'
const USER_TARGET = '00000000-0000-4000-8000-000000000005'
const USER_ORGANIZER_TWO = '00000000-0000-4000-8000-000000000006'
const EVENT_ONE = '10000000-0000-4000-8000-000000000001'
const EVENT_TWO = '10000000-0000-4000-8000-000000000002'
const TEAM_ONE = '20000000-0000-4000-8000-000000000001'
const TEAM_TWO = '20000000-0000-4000-8000-000000000002'

let db: PGlite

async function asRole<T>(role: 'anon' | 'authenticated', userId: string | null, work: () => Promise<T>, commit = false): Promise<T> {
  await db.exec('begin')
  try {
    await db.exec(`set local role ${role}`)
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ''])
    const result = await work()
    await db.exec(commit ? 'commit' : 'rollback')
    return result
  } catch (error) {
    await db.exec('rollback')
    throw error
  }
}

beforeAll(async () => {
  db = new PGlite({ extensions: { postgis } })
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create role supabase_auth_admin nologin;
    create schema auth;
    grant usage on schema auth to anon, authenticated, supabase_auth_admin;
    create table auth.users (
      id uuid primary key,
      email text unique,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated;
  `)

  const migrationsDirectory = join(process.cwd(), 'supabase/migrations')
  const migrations = (await readdir(migrationsDirectory)).filter((file) => file.endsWith('.sql')).sort()
  expect(migrations.length).toBeGreaterThan(0)
  for (const migration of migrations) {
    await db.exec(await readFile(join(migrationsDirectory, migration), 'utf8'))
  }

  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${USER_PARTICIPANT}', 'participant@example.test', '{"display_name":"Participant One"}'),
      ('${USER_ORGANIZER}', 'organizer@example.test', '{"display_name":"Organizer One"}'),
      ('${USER_MODERATOR}', 'moderator@example.test', '{"display_name":"Moderator One"}'),
      ('${USER_NO_MEMBERSHIP}', 'unassigned@example.test', '{"display_name":"Unassigned User","role":"organizer","permissions":["grant_organizer"]}'),
      ('${USER_TARGET}', 'target@example.test', '{"display_name":"Target User"}'),
      ('${USER_ORGANIZER_TWO}', 'organizer-two@example.test', '{"display_name":"Organizer Two"}');

    insert into public.events (id, name, slug, created_by) values
      ('${EVENT_ONE}', 'Event One', 'event-one', '${USER_ORGANIZER}'),
      ('${EVENT_TWO}', 'Event Two', 'event-two', '${USER_ORGANIZER}');

    insert into public.event_memberships (event_id, user_id, role, permissions, status, granted_by) values
      ('${EVENT_ONE}', '${USER_PARTICIPANT}', 'participant', '{}', 'active', '${USER_ORGANIZER}'),
      ('${EVENT_ONE}', '${USER_ORGANIZER}', 'organizer', array['view_members','manage_members','manage_roles','grant_moderator','review_reports','view_audit_log'], 'active', '${USER_ORGANIZER}'),
      ('${EVENT_TWO}', '${USER_MODERATOR}', 'moderator', array['review_reports'], 'active', '${USER_ORGANIZER}'),
      ('${EVENT_TWO}', '${USER_ORGANIZER_TWO}', 'organizer', array['view_members','manage_members','manage_roles','grant_moderator','grant_organizer','review_reports','view_audit_log'], 'active', '${USER_ORGANIZER_TWO}');

    insert into public.teams (id, event_id, name) values
      ('${TEAM_ONE}', '${EVENT_ONE}', 'Team One'),
      ('${TEAM_TWO}', '${EVENT_TWO}', 'Team Two');
    insert into public.team_memberships (event_id, team_id, user_id) values
      ('${EVENT_ONE}', '${TEAM_ONE}', '${USER_PARTICIPANT}'),
      ('${EVENT_TWO}', '${TEAM_TWO}', '${USER_MODERATOR}');

    insert into public.zones (event_id, name, boundary_type, boundary, radius_meters) values
      ('${EVENT_ONE}', 'Circle Zone', 'circle', st_setsrid(st_makepoint(-73.98, 40.75), 4326), 250),
      ('${EVENT_TWO}', 'Polygon Zone', 'polygon', st_geomfromtext('POLYGON((-74 40,-73.99 40,-73.99 40.01,-74 40.01,-74 40))', 4326), null);
  `)
})

afterAll(async () => {
  await db?.close()
})

describe('Phase 1 Postgres migration and RLS foundation', () => {
  it('replays versioned migrations on a clean Postgres + PostGIS database with RLS enabled', async () => {
    const tables = await db.query<{ tablename: string; rowsecurity: boolean }>(`
      select tablename, rowsecurity from pg_tables
      where schemaname = 'public' order by tablename
    `)
    expect(tables.rows.map((row) => row.tablename)).toEqual(expect.arrayContaining([
      'audit_events', 'event_invitations', 'event_memberships', 'events', 'profiles', 'team_memberships', 'teams', 'zones',
    ]))
    expect(tables.rows.every((row) => row.rowsecurity)).toBe(true)
    const postgisVersion = await db.query<{ extversion: string }>("select extversion from pg_extension where extname = 'postgis'")
    expect(postgisVersion.rows[0]?.extversion).toBeTruthy()
  })

  it('denies anonymous database access and limits members to their own event', async () => {
    await expect(asRole('anon', null, () => db.query('select * from public.events'))).rejects.toThrow()

    const participantEvents = await asRole('authenticated', USER_PARTICIPANT, () => db.query<{ slug: string }>('select slug from public.events order by slug'))
    expect(participantEvents.rows.map((row) => row.slug)).toEqual(['event-one'])

    const noMembershipEvents = await asRole('authenticated', USER_NO_MEMBERSHIP, () => db.query('select id from public.events'))
    expect(noMembershipEvents.rows).toHaveLength(0)
    const unassignedAccess = await asRole('authenticated', USER_NO_MEMBERSHIP, () => db.query<{ access: { user_id: string; display_name: string | null; memberships: unknown[] } }>(
      'select public.get_my_access() as access',
    ))
    expect(unassignedAccess.rows[0]?.access).toEqual({ user_id: USER_NO_MEMBERSHIP, display_name: 'Unassigned User', memberships: [] })
  })

  it('limits profiles, memberships, teams, team memberships and zones to the correct scope', async () => {
    const ownProfile = await asRole('authenticated', USER_PARTICIPANT, () => db.query('select display_name from public.profiles'))
    expect(ownProfile.rows).toEqual([{ display_name: 'Participant One' }])

    const memberRows = await asRole('authenticated', USER_PARTICIPANT, () => db.query('select user_id from public.event_memberships order by user_id'))
    expect(memberRows.rows).toEqual([{ user_id: USER_PARTICIPANT }])

    const teams = await asRole('authenticated', USER_PARTICIPANT, () => db.query<{ name: string }>('select name from public.teams'))
    expect(teams.rows.map((row) => row.name)).toEqual(['Team One'])
    const teamMembers = await asRole('authenticated', USER_PARTICIPANT, () => db.query<{ event_id: string; user_id: string }>('select event_id, user_id from public.team_memberships'))
    expect(teamMembers.rows).toEqual([{ event_id: EVENT_ONE, user_id: USER_PARTICIPANT }])
    const otherEventTeams = await asRole('authenticated', USER_PARTICIPANT, () => db.query('select id from public.teams where event_id = $1', [EVENT_TWO]))
    expect(otherEventTeams.rows).toHaveLength(0)
    const otherEventTeamMembers = await asRole('authenticated', USER_PARTICIPANT, () => db.query('select team_id from public.team_memberships where event_id = $1', [EVENT_TWO]))
    expect(otherEventTeamMembers.rows).toHaveLength(0)
    const zones = await asRole('authenticated', USER_PARTICIPANT, () => db.query<{ name: string }>('select name from public.zones'))
    expect(zones.rows.map((row) => row.name)).toEqual(['Circle Zone'])
  })

  it('does not let a client self-assign a team or change a trusted membership role', async () => {
    await expect(asRole('authenticated', USER_PARTICIPANT, () => db.query(
      'insert into public.team_memberships (event_id, team_id, user_id) values ($1, $2, $3)',
      [EVENT_ONE, TEAM_ONE, USER_NO_MEMBERSHIP],
    ))).rejects.toThrow()
    await expect(asRole('authenticated', USER_PARTICIPANT, () => db.query(
      "update public.event_memberships set role = 'organizer' where event_id = $1 and user_id = $2",
      [EVENT_ONE, USER_PARTICIPANT],
    ))).rejects.toThrow()
    await expect(asRole('authenticated', USER_PARTICIPANT, () => db.query(
      "insert into public.event_memberships (event_id, user_id, role, permissions) values ($1, $2, 'organizer', array['manage_members'])",
      [EVENT_ONE, USER_PARTICIPANT],
    ))).rejects.toThrow()
    await expect(asRole('authenticated', USER_PARTICIPANT, () => db.query(
      'select public.manage_event_membership($1, $2, $3, $4)',
      [EVENT_ONE, USER_TARGET, 'organizer', []],
    ))).rejects.toThrow(/permission|grant/i)
    await expect(asRole('authenticated', USER_ORGANIZER, () => db.query(
      'select public.manage_event_membership($1, $2, $3, $4)',
      [EVENT_ONE, USER_ORGANIZER, 'organizer', ['manage_members', 'manage_roles']],
    ))).rejects.toThrow(/your own event role/i)
  })

  it('keeps organizer and moderator permissions explicit and event-scoped', async () => {
    const organizerGrants = await asRole('authenticated', USER_ORGANIZER, () => db.query<{ can_review: boolean; can_remove: boolean; can_event_two: boolean }>(`
      select
        public.has_event_permission($1, 'review_reports') as can_review,
        public.has_event_permission($1, 'remove_content') as can_remove,
        public.has_event_permission($2, 'manage_members') as can_event_two
    `, [EVENT_ONE, EVENT_TWO]))
    expect(organizerGrants.rows[0]).toEqual({ can_review: true, can_remove: false, can_event_two: false })

    const moderatorGrants = await asRole('authenticated', USER_MODERATOR, () => db.query<{ can_review: boolean; can_remove: boolean; can_zone: boolean }>(`
      select
        public.has_event_permission($1, 'review_reports') as can_review,
        public.has_event_permission($1, 'remove_content') as can_remove,
        public.has_event_permission($1, 'manage_zones') as can_zone
    `, [EVENT_TWO]))
    expect(moderatorGrants.rows[0]).toEqual({ can_review: true, can_remove: false, can_zone: false })
  })

  it('requires permission to create invitations, hashes tokens, and only joins the invited event as a participant', async () => {
    const token = 'A'.repeat(43)
    await expect(asRole('authenticated', USER_PARTICIPANT, () => db.query(
      'select * from public.create_event_invitation($1, $2)', [EVENT_ONE, token],
    ))).rejects.toThrow(/permission/i)
    await expect(asRole('authenticated', USER_ORGANIZER, () => db.query(
      'select * from public.create_event_invitation($1, $2)', [EVENT_TWO, 'B'.repeat(43)],
    ))).rejects.toThrow(/permission/i)

    const created = await asRole('authenticated', USER_ORGANIZER, () => db.query<{ invitation_id: string }>(
      'select invitation_id from public.create_event_invitation($1, $2)', [EVENT_ONE, token],
    ), true)
    expect(created.rows).toHaveLength(1)
    const digest = await db.query<{ matches: boolean }>(
      'select token_hash = sha256(convert_to($1, \'UTF8\')) as matches from public.event_invitations where id = $2',
      [token, created.rows[0]?.invitation_id],
    )
    expect(digest.rows[0]?.matches).toBe(true)

    await asRole('authenticated', USER_NO_MEMBERSHIP, () => db.query('select public.accept_event_invitation($1)', [token]), true)
    const joined = await asRole('authenticated', USER_NO_MEMBERSHIP, () => db.query<{ role: string; status: string }>(
      'select role, status from public.event_memberships where event_id = $1 and user_id = $2',
      [EVENT_ONE, USER_NO_MEMBERSHIP],
    ))
    expect(joined.rows).toEqual([{ role: 'participant', status: 'active' }])
    await expect(asRole('authenticated', USER_TARGET, () => db.query('select public.accept_event_invitation($1)', [token]))).rejects.toThrow(/invalid|expired|used/i)

    const expiredToken = 'E'.repeat(43)
    await db.query(`
      insert into public.event_invitations (event_id, token_hash, expires_at, max_uses, created_by)
      values ($1, sha256(convert_to($2, 'UTF8')), now() - interval '1 second', 1, $3)
    `, [EVENT_ONE, expiredToken, USER_ORGANIZER])
    await expect(asRole('authenticated', USER_TARGET, () => db.query(
      'select public.accept_event_invitation($1)', [expiredToken],
    ))).rejects.toThrow(/invalid|expired/i)
  })

  it('allows an authorized manager to assign only explicit grants they themselves hold', async () => {
    await asRole('authenticated', USER_ORGANIZER, () => db.query(
      'select public.manage_event_membership($1, $2, $3, $4)',
      [EVENT_ONE, USER_TARGET, 'moderator', ['review_reports']],
    ), true)
    const grants = await asRole('authenticated', USER_TARGET, () => db.query<{ role: string; can_review: boolean; can_remove: boolean }>(`
      select role,
        public.has_event_permission($1, 'review_reports') as can_review,
        public.has_event_permission($1, 'remove_content') as can_remove
      from public.event_memberships where event_id = $1 and user_id = $2
    `, [EVENT_ONE, USER_TARGET]))
    expect(grants.rows).toEqual([{ role: 'moderator', can_review: true, can_remove: false }])

    await expect(asRole('authenticated', USER_ORGANIZER, () => db.query(
      'select public.manage_event_membership($1, $2, $3, $4)',
      [EVENT_ONE, USER_TARGET, 'moderator', ['remove_content']],
    ))).rejects.toThrow(/grant permissions|permission/i)
    await expect(asRole('authenticated', USER_ORGANIZER, () => db.query(
      'select public.manage_event_membership($1, $2, $3, $4)',
      [EVENT_ONE, USER_TARGET, 'organizer', []],
    ))).rejects.toThrow(/grant organizer/i)
  })

  it('revokes moderator access without violating role constraints or leaving event data readable', async () => {
    await asRole('authenticated', USER_ORGANIZER_TWO, () => db.query(
      'select public.revoke_event_membership($1, $2)',
      [EVENT_TWO, USER_MODERATOR],
    ), true)

    const revokedMembership = await asRole('authenticated', USER_MODERATOR, () => db.query<{ role: string; status: string; permissions: string[] }>(
      'select role, status, permissions from public.event_memberships where event_id = $1 and user_id = $2',
      [EVENT_TWO, USER_MODERATOR],
    ))
    expect(revokedMembership.rows).toEqual([{ role: 'moderator', status: 'revoked', permissions: ['review_reports'] }])

    const permission = await asRole('authenticated', USER_MODERATOR, () => db.query<{ allowed: boolean }>(
      "select public.has_event_permission($1, 'review_reports') as allowed",
      [EVENT_TWO],
    ))
    expect(permission.rows[0]?.allowed).toBe(false)
    const hiddenTeam = await asRole('authenticated', USER_MODERATOR, () => db.query(
      'select id from public.teams where event_id = $1',
      [EVENT_TWO],
    ))
    expect(hiddenTeam.rows).toHaveLength(0)

    const audit = await asRole('authenticated', USER_ORGANIZER_TWO, () => db.query<{ action: string; metadata: Record<string, unknown> }>(
      "select action, metadata from public.audit_events where event_id = $1 and action = 'event.membership.revoked'",
      [EVENT_TWO],
    ))
    expect(audit.rows).toEqual([{
      action: 'event.membership.revoked',
      metadata: { previous_role: 'moderator', previous_permissions: ['review_reports'] },
    }])
  })

  it('prevents members without audit permission from reading audit rows or writing them directly', async () => {
    const hidden = await asRole('authenticated', USER_PARTICIPANT, () => db.query('select id from public.audit_events'))
    expect(hidden.rows).toHaveLength(0)
    await expect(asRole('authenticated', USER_PARTICIPANT, () => db.query(
      "insert into public.audit_events (event_id, actor_user_id, action) values ($1, $2, 'forged')",
      [EVENT_ONE, USER_PARTICIPANT],
    ))).rejects.toThrow()

    const visible = await asRole('authenticated', USER_ORGANIZER, () => db.query<{ action: string }>('select action from public.audit_events'))
    expect(visible.rows.some((row) => row.action === 'event.invitation.created')).toBe(true)
  })

  it('records valid PostGIS circle and polygon boundaries and rejects malformed shapes', async () => {
    const count = await db.query<{ count: number }>('select count(*)::int as count from public.zones')
    expect(count.rows[0]?.count).toBe(2)
    await expect(db.query(`insert into public.zones (event_id, name, boundary_type, boundary, radius_meters)
      values ($1, 'Bad Circle', 'circle', st_geomfromtext('POLYGON((0 0,1 0,1 1,0 0))', 4326), 100)`, [EVENT_ONE])).rejects.toThrow()
  })
})
