import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { EventMembershipAccess } from "../lib/database.types";
import { useApi, useQuery } from "./api";
import type { Overview, Post } from "./api";
import { ActionForm, QueryState } from "./forms";
import { Feed, PostComposer, PostDetail } from "./Feed";
const ZoneMap = lazy(() =>
  import("./ZoneMap").then((module) => ({ default: module.ZoneMap })),
);
const Audit = lazy(() => import("./Staff").then((m) => ({ default: m.Audit })));
const EventSettings = lazy(() =>
  import("./Staff").then((m) => ({ default: m.EventSettings })),
);
const Moderation = lazy(() =>
  import("./Staff").then((m) => ({ default: m.Moderation })),
);
const RosterImport = lazy(() =>
  import("./Staff").then((m) => ({ default: m.RosterImport })),
);
const Teams = lazy(() => import("./Staff").then((m) => ({ default: m.Teams })));
const Communications = lazy(() =>
  import("./Messaging").then((m) => ({ default: m.Communications })),
);
const Conversations = lazy(() =>
  import("./Messaging").then((m) => ({ default: m.Conversations })),
);
const Notifications = lazy(() =>
  import("./Messaging").then((m) => ({ default: m.Notifications })),
);
import { createPortal } from "react-dom";
import {
  Users,
  PlusSquare,
  MapPin,
  Users2,
  Activity,
  Shield,
  FileText,
  MessageSquare,
  Radio,
  Bell,
  Settings,
  Upload,
  BarChart3,
  CheckSquare,
  History,
} from "lucide-react";
import { Safety } from "./Safety";
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
  const [sidebarSlot, setSidebarSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const updateSlot = () => {
      const desktop = window.innerWidth >= 1024;
      if (desktop) {
        setSidebarSlot(document.getElementById("stitch-sidebar-nav-root"));
      } else {
        setSidebarSlot(null);
      }
    };
    updateSlot();
    window.addEventListener("resize", updateSlot);
    return () => window.removeEventListener("resize", updateSlot);
  }, []);

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
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [page]);
  const navigate = (next: string, resource?: string) => {
    setParams({ page: next, ...(resource ? { id: resource } : {}) });
    setRevision(undefined);
    q.refresh();
  };
  const valid =
    q.data && Array.isArray(q.data.zones) && Array.isArray(q.data.memberships);
  const o = valid ? q.data : null;

  const workflowGroups = [
    {
      title: "Community",
      roleGated: false,
      items: [
        { key: "feed", label: "Community", icon: Users },
        { key: "create", label: "Create a post", icon: PlusSquare },
        { key: "zones", label: "Zones & map", icon: MapPin },
        { key: "teams", label: "Teams", icon: Users2 },
      ],
    },
    {
      title: "My Activity",
      roleGated: false,
      items: [
        { key: "activity", label: "My activity", icon: Activity },
        { key: "privacy", label: "Privacy & preferences", icon: Shield },
        { key: "safety", label: "My reports & decisions", icon: FileText },
      ],
    },
    {
      title: "Communication",
      roleGated: false,
      items: [
        { key: "conversations", label: "Talk to organizers", icon: MessageSquare },
        { key: "communications", label: "Communications", icon: Radio },
        { key: "notifications", label: `Notifications${o ? " · " + o.unread : ""}`, icon: Bell },
      ],
    },
    {
      title: "Organizer Console",
      roleGated: true,
      items: [
        ...(permissions.includes("manage_event")
          ? [{ key: "settings", label: "Event settings", icon: Settings }]
          : []),
        ...(permissions.includes("manage_members")
          ? [{ key: "roster", label: "Roster import", icon: Upload }]
          : []),
        ...(permissions.includes("review_reports")
          ? [{ key: "reports", label: "Reports", icon: BarChart3 }]
          : []),
        ...(permissions.includes("review_custom_posts")
          ? [{ key: "review", label: "Post review", icon: CheckSquare }]
          : []),
        ...(permissions.includes("view_audit_log")
          ? [{ key: "audit", label: "Audit log", icon: History }]
          : []),
      ],
    },
  ].filter((group) => group.items.length > 0);

  const pages = workflowGroups.flatMap((group) =>
    group.items.map((item) => [item.key, item.label] as [string, string]),
  );

  const sidebarNavContent = (
    <nav className="dz-navigation stitch-sidebar-nav" aria-label="Event workflows">
      {workflowGroups.map((group) => (
        <div key={group.title} className="stitch-nav-group">
          <div className="stitch-nav-header">
            <span>{group.title}</span>
            {group.roleGated && (
              <span className="stitch-role-gated-tag">Role Gated</span>
            )}
          </div>
          <div className="stitch-nav-items">
            {group.items.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-current={page === item.key ? "page" : undefined}
                className={`stitch-nav-btn ${page === item.key ? "active" : ""}`}
                onClick={() => navigate(item.key)}
              >
                <item.icon size={16} aria-hidden="true" />
                <span className="stitch-nav-label">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );

  const fallbackNav = (
    <nav className="dz-navigation" aria-label="Event workflows">
      {pages.map(([key, label]) => (
        <button
          aria-current={page === key ? "page" : undefined}
          className={page === key ? "active" : ""}
          key={key}
          onClick={() => navigate(key)}
        >
          {label}
        </button>
      ))}
    </nav>
  );

  return (
    <Suspense fallback={<p role="status">Loading workspace tools…</p>}>
      <div className="dz-workbench">
        <h2 ref={heading} tabIndex={-1} className="sr-only">
          {pages.find(([key]) => key === page)?.[1] ?? "Post details"}
        </h2>
        {sidebarSlot ? createPortal(sidebarNavContent, sidebarSlot) : fallbackNav}
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
            {(["feed", "activity"].includes(page) ||
              (page === "review" &&
                permissions.includes("review_custom_posts"))) && (
              <Feed
                eventId={e}
                mode={page as "feed" | "activity" | "review"}
                zones={o.zones}
                open={(id) => navigate("post", id)}
                onOpenMap={() => navigate("zones")}
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
            {page === "safety" && <Safety eventId={e} />}
            {!pages.some(([key]) => key === page) && page !== "post" && (
              <p role="alert">
                This page is unavailable or your account lacks the required
                permission. Choose an authorized page above.
              </p>
            )}
            {page === "privacy" && (
              <section className="workspace-panel">
                <h2>Privacy & preferences</h2>
                <p>
                  Location is requested only for map centering or required
                  posting checks. Coordinates are not stored. Browser GPS can be
                  inaccurate or spoofed; it is not proof of physical presence.
                </p>
                <p>
                  Deleted content is hidden immediately; text is eligible for
                  redaction after 30 days by server maintenance. Audit records
                  and backups may retain information. Private organizer
                  conversations are visible to staff with the explicit
                  manage-members permission.
                </p>
                <p>
                  Block restricts peer content visibility and interactions in
                  both directions. Mute suppresses your feed and notification
                  alerts from that author, without blocking access. Reports
                  request a human review and do not automatically remove
                  content.
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
    </Suspense>
  );
}
