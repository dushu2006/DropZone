// Test-only entry. Not imported by src/main or included in the production Vite build.
import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../../src/App";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/manrope/latin-700.css";
import "../../src/styles.css";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/database.types";
const params = new URLSearchParams(location.search),
  role = params.get("role") ?? "participant";
const uid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  eid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  pid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const grants = [
  "manage_event",
  "manage_teams",
  "manage_zones",
  "manage_members",
  "view_members",
  "manage_roles",
  "grant_organizer",
  "grant_moderator",
  "review_reports",
  "remove_content",
  "review_custom_posts",
  "view_audit_log",
];
let session: unknown =
  role === "anonymous"
    ? null
    : {
        access_token: "test-only",
        refresh_token: "test-only",
        user: { id: uid, email: "browser@example.test" },
        expires_in: 3600,
      };
let callback: (e: string, s: unknown) => void = () => {};
const member = {
  event_id: eid,
  event_name: "Browser fixture event",
  event_slug: "browser-fixture",
  role,
  permissions:
    role === "organizer"
      ? grants
      : role === "moderator"
        ? grants.filter((p) => /review|remove|audit/.test(p))
        : [],
  status: "active",
};
const post = {
  id: pid,
  event_id: eid,
  author_id: uid,
  author_name: "Fixture author",
  title: "Fixture question",
  body: "This is isolated test content, never production data.",
  category:
    params.get("postStatus") === "rejected" ? "custom" : "community_question",
  fields:
    params.get("postStatus") === "rejected"
      ? { reason: "Revise isolated submission" }
      : { topic: "workshop" },
  status: params.get("postStatus") ?? "published",
  effective_status: params.get("postStatus") ?? "published",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 3600000).toISOString(),
};
const calls: { name: string; args: unknown }[] = [];
(window as unknown as { fixtureCalls: unknown }).fixtureCalls = calls;
const client = {
  auth: {
    getSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange: (cb: typeof callback) => {
      callback = cb;
      queueMicrotask(() => callback("INITIAL_SESSION", session));
      return { data: { subscription: { unsubscribe() {} } } };
    },
    signOut: async () => {
      session = null;
      callback("SIGNED_OUT", null);
      return { error: null };
    },
    signInWithPassword: async () => ({
      error: Object.assign(new Error("Invalid login credentials"), {
        status: 400,
      }),
    }),
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    signUp: async () => ({ data: { session: null }, error: null }),
  },
  rpc: async (name: string, args: any) => {
    calls.push({ name, args });
    if (name === "get_my_access")
      return {
        data: {
          user_id: uid,
          display_name: "Browser fixture",
          memberships: [member],
        },
        error: null,
      };
    if (name === "create_event_invitation") return { data: [], error: null };
    if (name === "dz_command")
      return {
        data: {
          ...post,
          id: pid,
          status:
            args.p_data.category === "custom" ? "awaiting_review" : "published",
          recipients: 0,
        },
        error: null,
      };
    if (name === "dz_read") {
      const kind = args.p_kind;
      const data =
        kind === "overview"
          ? {
              event: {
                id: eid,
                name: "Browser fixture event",
                description: "Fixture",
                status: "active",
                location_required: false,
                max_accuracy_meters: 100,
                downloads_allowed: false,
              },
              zones: [],
              teams: [],
              memberships: [],
              team_memberships: [],
              unread: 0,
              active_posts: 0,
              preferences: [],
            }
          : kind === "post"
            ? post
            : kind === "safety"
              ? { reports: [], restrictions: [], decisions: [] }
              : [];
      return { data, error: null };
    }
    return { data: null, error: null };
  },
};
createRoot(document.getElementById("root")!).render(
  <MemoryRouter
    initialEntries={[params.get("path") ?? `/app/events/${eid}/${role}`]}
  >
    <AppRoutes client={client as unknown as SupabaseClient<Database>} />
  </MemoryRouter>,
);
