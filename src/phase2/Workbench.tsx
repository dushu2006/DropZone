import { lazy, Suspense, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { EventMembershipAccess } from "../lib/database.types";
import { useApi, useQuery } from "./api";
import type { Overview, Post } from "./api";
import { ActionForm, QueryState } from "./forms";
import { Feed, PostComposer, PostDetail } from "./Feed";
const ZoneMap = lazy(() =>
  import("./ZoneMap").then((module) => ({ default: module.ZoneMap })),
);
import { Audit, EventSettings, Moderation, RosterImport, Teams } from "./Staff";
import { Communications, Conversations, Notifications } from "./Messaging";
import "./phase2.css";
export function Workbench({
  membership,
}: {
  membership: EventMembershipAccess;
}) {
  const e = membership.event_id,
    permissions = membership.permissions,
    q = useQuery<Overview>(e, "overview"),
    { command } = useApi(e),
    [params, setParams] = useSearchParams(),
    [revision, setRevision] = useState<Post>();
  const page =
      params.get("page") ??
      (membership.role === "moderator"
        ? permissions.includes("review_reports")
          ? "reports"
          : permissions.includes("review_custom_posts")
            ? "review"
            : permissions.includes("view_audit_log")
              ? "audit"
              : "feed"
        : "feed"),
    id = params.get("id") ?? "";
  const navigate = (next: string, resource?: string) => {
    setParams({ page: next, ...(resource ? { id: resource } : {}) });
    setRevision(undefined);
    q.refresh();
  };
  const valid =
    q.data && Array.isArray(q.data.zones) && Array.isArray(q.data.memberships);
  const o = valid ? q.data : null;
  const pages = [
    ["feed", "Community"],
    ["create", "Create a post"],
    ["activity", "My activity"],
    ["zones", "Zones & map"],
    ["conversations", "Talk to organizers"],
    ["communications", "Communications"],
    ["notifications", `Notifications${o ? " · " + o.unread : ""}`],
    ["teams", "Teams"],
    ["privacy", "Privacy & preferences"],
    ...(permissions.includes("manage_event")
      ? [["settings", "Event settings"]]
      : []),
    ...(permissions.includes("manage_members")
      ? [["roster", "Roster import"]]
      : []),
    ...(permissions.includes("review_reports") ? [["reports", "Reports"]] : []),
    ...(permissions.includes("review_custom_posts")
      ? [["review", "Post review"]]
      : []),
    ...(permissions.includes("view_audit_log") ? [["audit", "Audit log"]] : []),
  ];
  return (
    <div className="dz-workbench">
      <nav className="dz-navigation" aria-label="Event workflows">
        {pages.map(([key, label]) => (
          <button
            className={page === key ? "active" : ""}
            key={key}
            onClick={() => navigate(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      <QueryState {...q} retry={q.refresh} />
      {!q.loading && !q.error && !valid && (
        <p role="alert">
          Workflow data could not be loaded. Ensure all Phase 2 migrations are
          applied, then refresh.
        </p>
      )}
      {o && (
        <>
          <div className="dz-metrics">
            <span>{o.active_posts} authorized active posts</span>
            <span>{o.zones.length} event zones</span>
            <span>{o.unread} unread notifications</span>
            <button className="secondary-button" onClick={q.refresh}>
              Refresh counts
            </button>
          </div>
          {["feed", "activity", "review"].includes(page) && (
            <Feed
              eventId={e}
              mode={page as "feed" | "activity" | "review"}
              open={(id) => navigate("post", id)}
            />
          )}
          {page === "create" && (
            <PostComposer
              eventId={e}
              overview={o}
              revision={revision}
              onSaved={(id) => navigate("post", id)}
            />
          )}
          {page === "post" && id && (
            <PostDetail
              key={id}
              eventId={e}
              id={id}
              overview={o}
              permissions={permissions}
              onRevise={(p) => {
                setRevision(p);
                setParams({ page: "create" });
              }}
            />
          )}
          {page === "zones" && (
            <Suspense fallback={<p>Loading interactive map…</p>}>
              <ZoneMap
                eventId={e}
                zones={o.zones}
                editable={permissions.includes("manage_zones")}
                refresh={q.refresh}
              />
            </Suspense>
          )}
          {page === "conversations" && (
            <Conversations key={id} eventId={e} initialId={id} />
          )}
          {page === "communications" && (
            <Communications
              eventId={e}
              overview={o}
              canSend={permissions.includes("manage_event")}
            />
          )}
          {page === "notifications" && (
            <Notifications
              eventId={e}
              navigate={navigate}
              refresh={q.refresh}
            />
          )}
          {page === "teams" && (
            <Teams
              eventId={e}
              overview={o}
              permissions={permissions}
              refresh={q.refresh}
            />
          )}
          {page === "roster" && permissions.includes("manage_members") && (
            <RosterImport eventId={e} />
          )}
          {page === "settings" && permissions.includes("manage_event") && (
            <EventSettings eventId={e} overview={o} refresh={q.refresh} />
          )}
          {page === "reports" && permissions.includes("review_reports") && (
            <Moderation eventId={e} permissions={permissions} />
          )}
          {page === "audit" && permissions.includes("view_audit_log") && (
            <Audit eventId={e} />
          )}
          {page === "privacy" && (
            <section className="workspace-panel">
              <h2>Privacy & preferences</h2>
              <p>
                Location is requested only for map centering or required posting
                checks. Coordinates are not stored. Browser GPS can be
                inaccurate or spoofed; it is not proof of physical presence.
              </p>
              <p>
                Deleted content is hidden immediately; text is eligible for
                redaction after 30 days by server maintenance. Audit records and
                backups may retain information. Private organizer conversations
                are visible to staff with the explicit manage-members
                permission.
              </p>
              <p>
                Block restricts peer content visibility and interactions in both
                directions. Mute suppresses your feed and notification alerts
                from that author, without blocking access. Reports request a
                human review and do not automatically remove content.
              </p>
              {o.preferences.map((p) => (
                <div className="dz-post" key={p.target_id}>
                  <p>
                    {p.target_id} · {p.blocked ? "Blocked" : ""}{" "}
                    {p.muted ? "Muted" : ""}
                  </p>
                  <ActionForm
                    fields={[]}
                    label="Clear preference"
                    submit={async (_, key) => {
                      await command(
                        "preference.set",
                        {
                          target_id: p.target_id,
                          blocked: false,
                          muted: false,
                        },
                        key,
                      );
                      q.refresh();
                    }}
                  />
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
