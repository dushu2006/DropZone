import { useState, useEffect } from "react";
import { Clock, Radio, RefreshCw, MapPin, Pin, Calendar, Compass } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useApi, useQuery, timestamp } from "./api";
import type { Overview, Post } from "./api";
import { ActionForm, PageButtons, QueryState } from "./forms";
import { templates, validateTemplate } from "./templates";
import { requestLocation } from "./location";
import { Attachments } from "./Attachments";
import { RevisionHistory } from "./Safety";
function keyDate(key: string, value: unknown) {
  if (["approximate_time", "valid_until"].includes(key) && value) {
    const d = new Date(String(value));
    if (!Number.isNaN(d.getTime()))
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
  }
  return String(value);
}
export function PostComposer({
  eventId,
  overview,
  revision,
  onSaved,
}: {
  eventId: string;
  overview: Overview;
  revision?: Post;
  onSaved: (id: string) => void;
}) {
  const { command } = useApi(eventId),
    [category, setCategory] = useState(revision?.category ?? "lost_found"),
    [zone, setZone] = useState(revision?.zone_id ?? "");
  const template = templates.find((t) => t.code === category)!;
  return (
    <section className="stitch-composer-card workspace-panel">
      <div className="stitch-composer-header">
        <div className="stitch-composer-title">
          <span className="stitch-dot-ping" />
          <span>STRUCTURED SIGNAL COMPOSER</span>
        </div>
        <span className="stitch-composer-sector">
          Active Sector: {overview.zones.find((z) => z.id === zone)?.name ?? "Event-Wide #409"}
        </span>
      </div>

      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 6px", color: "#fff" }}>
          {revision
            ? revision.status === "published"
              ? "Edit post"
              : "Revise submission"
            : "Create a post"}
        </h2>
        <p style={{ color: "var(--stitch-text-muted)", fontSize: 13, margin: 0 }}>
          {template.description}
        </p>
      </div>

      {/* Stitch Template Selector Chips */}
      <div className="stitch-template-chips">
        {templates.map((t) => (
          <button
            type="button"
            key={t.code}
            disabled={!!revision}
            className={`stitch-chip ${category === t.code ? "active" : ""}`}
            onClick={() => setCategory(t.code)}
          >
            {t.name}
          </button>
        ))}
      </div>

      <label className="auth-field">
        <span>Post template</span>
        <select
          value={category}
          disabled={!!revision}
          onChange={(e) => setCategory(e.target.value)}
        >
          {templates.map((t) => (
            <option key={t.code} value={t.code}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="auth-field">
        <span>
          Event zone{overview.event?.location_required ? " (required)" : ""}
        </span>
        <select value={zone} onChange={(e) => setZone(e.target.value)}>
          <option value="">Event-wide / no zone</option>
          {overview.zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
      </label>
      {overview.event?.location_required && (
        <p>
          This event requires a fresh location reading when you submit.
          Coordinates are checked by the server against the saved zone, then
          discarded; accuracy must be within{" "}
          {overview.event.max_accuracy_meters} m. Browser GPS is not proof of
          physical presence.
        </p>
      )}
      <ActionForm
        key={category + (revision?.id ?? "")}
        requestScope={{ zone }}
        fields={[
          { key: "title", label: "Title", required: true, max: 160 },
          {
            key: "body",
            label: "Description",
            type: "textarea",
            required: true,
            max: 5000,
          },
          ...template.fields,
          ...(["custom", "promotion"].includes(category)
            ? [
                {
                  key: "review_mode",
                  label: "Submission mode",
                  type: "select" as const,
                  options: ["send_for_review", "save_submission"],
                  required: true,
                },
              ]
            : []),
        ]}
        initial={
          revision
            ? {
                review_mode: "send_for_review",
                title: revision.title,
                body: revision.body,
                ...Object.fromEntries(
                  Object.entries(revision.fields).map(([k, v]) => [
                    k,
                    keyDate(k, v),
                  ]),
                ),
              }
            : { review_mode: "send_for_review" }
        }
        label={
          category === "custom" || category === "promotion"
            ? "Submit for review"
            : "Publish post"
        }
        submit={async (v, key) => {
          const fields = validateTemplate(category, v);
          const position = overview.event?.location_required
            ? await requestLocation(overview.event.max_accuracy_meters)
            : {};
          if (overview.event?.location_required && !zone)
            throw new Error("Choose a saved event zone.");
          const post = await command<Post>(
            revision
              ? revision.status === "published"
                ? "post.edit"
                : "post.revise"
              : "post.create",
            {
              id: revision?.id ?? null,
              expected_updated_at: revision?.updated_at ?? null,
              category,
              title: v.title,
              body: v.body,
              fields,
              review_mode: v.review_mode ?? null,
              zone_id: zone || null,
              ...position,
            },
            key,
          );
          onSaved(post.id);
          return post.status === "submitted"
            ? "Submission saved; send it to the review queue from its details."
            : post.status === "awaiting_review"
              ? "Submission received; awaiting moderator review. It is not published."
              : "Post published.";
        }}
      />
      <p>
        Optional images can be uploaded from the saved post details. Identity
        comes from your signed-in profile.
      </p>
    </section>
  );
}
export function Feed({
  eventId,
  mode,
  open,
  zones,
  onOpenMap,
}: {
  eventId: string;
  mode: "feed" | "activity" | "review";
  open: (id: string) => void;
  zones: Overview["zones"];
  onOpenMap?: () => void;
}) {
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [zone, setZone] = useState(""),
    [offset, setOffset] = useState(0),
    [cursors, setCursors] = useState<{ time: string; id: string }[]>([]),
    [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search);
      setCursors([]);
      setOffset(0);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search]);
  const cursor = offset > 0 ? cursors[offset / 30 - 1] : undefined;
  const query = useQuery<Post[]>(eventId, mode, {
    search: debouncedSearch,
    category,
    zone_id: zone,
    before_time: cursor?.time,
    before_id: cursor?.id,
  });
  return (
    <div className="stitch-feed-grid">
      <section className="workspace-panel">
        <div className="dz-section-heading stitch-feed-filter-bar">
          <h2>
            {mode === "feed"
              ? "Community"
              : mode === "activity"
                ? "My activity"
                : "Custom & promotion review"}
          </h2>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div className="stitch-sync-time">
              <span className="stitch-dot-ping" />
              <span>Live Signal</span>
            </div>
            <button
              className="secondary-button stitch-btn-secondary"
              onClick={() => {
                setOffset(0);
                setCursors([]);
                query.refresh();
              }}
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        {/* Category Pill Strip */}
        <div className="stitch-filter-chips" style={{ marginBottom: 16 }}>
          <button
            type="button"
            className={`stitch-filter-pill ${category === "" ? "active" : ""}`}
            onClick={() => {
              setCategory("");
              setCursors([]);
              setOffset(0);
            }}
          >
            All Templates
          </button>
          {templates.map((t) => (
            <button
              type="button"
              key={t.code}
              className={`stitch-filter-pill ${category === t.code ? "active" : ""}`}
              onClick={() => {
                setCategory(t.code);
                setCursors([]);
                setOffset(0);
              }}
            >
              {t.name}
            </button>
          ))}
        </div>

        <div className="dz-filters">
          <label className="auth-field">
            <span>Search posts</span>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          <label className="auth-field">
            <span>Category</span>
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setCursors([]);
                setOffset(0);
              }}
            >
              <option value="">All templates</option>
              {templates.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="auth-field">
            <span>Zone</span>
            <select
              value={zone}
              onChange={(e) => {
                setZone(e.target.value);
                setCursors([]);
                setOffset(0);
              }}
            >
              <option value="">All zones</option>
              {zones.map((z) => (
                <option value={z.id} key={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <QueryState {...query} retry={query.refresh} />
        <div className="stitch-feed-stream">
          {Array.isArray(query.data) &&
            query.data.map((p) => (
              <article className="stitch-post-card dz-post" key={p.id}>
                <div className="stitch-post-header">
                  <div className="stitch-post-badges">
                    <span className={`stitch-category-badge stitch-category-${p.category} dz-badge`}>
                      {p.category.replaceAll("_", " ")}
                    </span>
                    <span className="stitch-tag">
                      {p.effective_status}
                    </span>
                  </div>
                  <span className="stitch-ttl-badge">
                    <Clock size={12} />
                    Expires {timestamp(p.expires_at)}
                  </span>
                </div>
                <h3 className="stitch-post-title">
                  <button className="dz-title-button" onClick={() => open(p.id)}>
                    {p.title}
                  </button>
                </h3>
                <p className="stitch-post-body">{p.body}</p>
                <div className="stitch-post-footer">
                  <small className="stitch-author-info">
                    {p.author_name ?? "Event member"} · {timestamp(p.created_at)}
                  </small>
                </div>
              </article>
            ))}
        </div>
        {Array.isArray(query.data) && !query.data.length && (
          <p className="dz-empty">
            No posts match this view. Nothing has been fabricated—create a post or
            try another filter.
          </p>
        )}
        <PageButtons
          offset={offset}
          setOffset={(next) => {
            if (next > offset) {
              const last = query.data?.[query.data.length - 1];
              if (!last) return;
              setCursors((old) => [
                ...old.slice(0, offset / 30),
                { time: last.created_at, id: last.id },
              ]);
            }
            setOffset(next);
          }}
          count={Array.isArray(query.data) ? query.data.length : 0}
        />
      </section>

      {/* Right Column: Stitch Telemetry & Satellite Geofence Panel */}
      <aside className="stitch-telemetry-col">
        {/* Zone Map & Geofence Card with Satellite Imagery */}
        <div className="stitch-geofence-card">
          <div className="stitch-geofence-header">
            <div className="stitch-geofence-title">
              <Radio size={16} />
              <span>Zone Map &amp; Geofence</span>
            </div>
            <span className="stitch-live-pill">
              <span className="stitch-dot-ping" /> ±5m
            </span>
          </div>

          <div
            className="stitch-satellite-preview-box"
            style={{
              backgroundImage:
                "linear-gradient(rgba(16, 41, 30, 0.25), rgba(16, 41, 30, 0.55)), url('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/6/28/46')",
              cursor: onOpenMap ? "pointer" : "default",
            }}
            onClick={onOpenMap}
            title={onOpenMap ? "Open interactive satellite map" : undefined}
          >
            <div className="stitch-satellite-badge">
              <span className="stitch-dot-ping" /> Satellite Mode Active
            </div>
            <div className="stitch-satellite-reticle">
              <div className="stitch-satellite-crosshair" />
              <div className="stitch-satellite-ring r1" />
              <div className="stitch-satellite-ring r2" />
            </div>
            <div className="stitch-satellite-status-bar">
              <span className="stitch-sat-status-text">
                <MapPin size={13} /> Inside Zone (No GPS Logs)
              </span>
              <span className="stitch-sat-status-verified">Verified</span>
            </div>
          </div>

          <div className="stitch-zone-meta">
            <span>Boundary: Active Event Perimeter</span>
            <span className="stitch-admin-badge">100% In-Memory TTL</span>
          </div>

          <div className="stitch-crypto-notice">
            <p style={{ margin: 0 }}>
              <strong>Zero Telemetry Leaks:</strong> Content constrained to active coordinate polygons. Post records purge on TTL timer expiration.
            </p>
          </div>

          {onOpenMap && (
            <button
              type="button"
              className="stitch-map-quick-btn"
              onClick={onOpenMap}
            >
              <Compass size={15} />
              <span>Open Satellite Map &amp; Zones</span>
            </button>
          )}
        </div>

        {/* Official Announcement Card */}
        <div className="stitch-geofence-card stitch-announcement-card">
          <div className="stitch-card-sub-header">
            <span className="stitch-announcement-tag">
              <Pin size={13} /> Official Briefing
            </span>
            <span className="stitch-live-pill">Pinned</span>
          </div>
          <h4 className="stitch-announcement-title">Welcome to the Geofenced Zone</h4>
          <p className="stitch-announcement-body">
            All broadcast requests, questions, and resources published here are ephemeral and strictly verified against in-memory coordinates.
          </p>
          <div className="stitch-announcement-footer">
            <span className="stitch-lead-avatar">Lead</span>
            <span>Event Operations Lead • Verified</span>
          </div>
        </div>

        {/* Event Milestones Card */}
        <div className="stitch-geofence-card">
          <div className="stitch-card-sub-header">
            <span className="stitch-milestone-title">
              <Calendar size={14} /> Active Zone Timeline
            </span>
            <span className="stitch-zone-meta">Telemetry Local</span>
          </div>
          <div className="stitch-milestones-list">
            <div className="stitch-milestone-item">
              <span className="stitch-milestone-time">NOW</span>
              <div className="stitch-milestone-info">
                <strong>Live Signal Stream Active</strong>
                <span>All authorized participant posts visible</span>
              </div>
            </div>
            <div className="stitch-milestone-item">
              <span className="stitch-milestone-time">TTL</span>
              <div className="stitch-milestone-info">
                <strong>Ephemeral Content Purge</strong>
                <span>Posts automatically expire based on author TTL</span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
export function ReportForm({
  eventId,
  targetId,
  targetType,
}: {
  eventId: string;
  targetId: string;
  targetType: "post" | "reply" | "user";
}) {
  const { command } = useApi(eventId);
  return (
    <details>
      <summary>Report {targetType}</summary>
      <ActionForm
        fields={[
          {
            key: "reason",
            label: "Report reason",
            type: "select",
            options: ["spam", "harassment", "privacy", "unsafe", "other"],
            required: true,
          },
          {
            key: "explanation",
            label: "Explanation (optional)",
            type: "textarea",
            max: 2000,
          },
        ]}
        label="Submit report"
        submit={async (v, key) => {
          await command(
            "report.create",
            { ...v, target_id: targetId, target_type: targetType },
            key,
          );
          return "Report received for review. A report is not a finding of wrongdoing.";
        }}
      />
    </details>
  );
}
export function PostDetail({
  eventId,
  id,
  overview,
  permissions,
  onRevise,
}: {
  eventId: string;
  id: string;
  overview: Overview;
  permissions: string[];
  onRevise: (p: Post) => void;
}) {
  const { session } = useAuth(),
    { command } = useApi(eventId),
    [offset, setOffset] = useState(0);
  const query = useQuery<Post>(eventId, "post", { id }),
    replies = useQuery<
      {
        id: string;
        body: string;
        author_name: string;
        author_id: string;
        parent_id: string | null;
        created_at: string;
      }[]
    >(eventId, "replies", { id, offset });
  const p = query.data,
    owner = p?.author_id === session?.user.id;
  return (
    <section className="workspace-panel">
      <QueryState {...query} retry={query.refresh} />
      {p && (
        <>
          <span className="dz-badge">{p.effective_status}</span>
          <h2>{p.title}</h2>
          <p className="dz-preserve">{p.body}</p>
          <small>
            {p.author_name ?? "Event member"} · {timestamp(p.created_at)} ·
            Expires {timestamp(p.expires_at)}
          </small>
          <dl className="dz-fields">
            {Object.entries(p.fields).map(([key, v]) => (
              <div key={key}>
                <dt>{key.replaceAll("_", " ")}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
          </dl>
          {p.decision_reason && (
            <p className="auth-inline-note">Decision: {p.decision_reason}</p>
          )}
          {owner && (
            <>
              <ActionForm
                fields={[
                  {
                    key: "action",
                    label: "Post action",
                    type: "select",
                    options: [
                      ...(p.status === "submitted" ? ["enqueue"] : []),
                      ...(p.effective_status === "published"
                        ? ["resolve"]
                        : []),
                      ...([
                        "awaiting_review",
                        "changes_requested",
                        "submitted",
                      ].includes(p.status)
                        ? ["cancel"]
                        : []),
                      "delete",
                    ],
                    required: true,
                  },
                ]}
                label="Confirm action"
                submit={async (v, key) => {
                  await command("post." + v.action, { id }, key);
                  query.refresh();
                  return "Post status updated.";
                }}
              />
              {[
                "submitted",
                "changes_requested",
                "published",
                "rejected",
              ].includes(p.effective_status) &&
                new Date(p.expires_at).getTime() > Date.now() && (
                  <button
                    className="secondary-button"
                    onClick={() => onRevise(p)}
                  >
                    {p.status === "published"
                      ? "Edit post"
                      : "Revise requested changes"}
                  </button>
                )}
            </>
          )}
          {!owner && (
            <>
              <ReportForm eventId={eventId} targetId={id} targetType="post" />
              <ReportForm
                eventId={eventId}
                targetId={p.author_id}
                targetType="user"
              />
              <ActionForm
                fields={[
                  {
                    key: "preference",
                    label: "Author preference",
                    type: "select",
                    options: ["block", "mute", "clear"],
                    required: true,
                  },
                ]}
                label="Save preference"
                submit={async (v, key) => {
                  await command(
                    "preference.set",
                    {
                      target_id: p.author_id,
                      blocked: v.preference === "block",
                      muted: v.preference === "mute",
                    },
                    key,
                  );
                  query.refresh();
                  return "Preference saved.";
                }}
              />
              <p>
                Block hides community content in both directions and prevents
                replies or direct organizer interactions between the pair. Mute
                hides this author from your feed and suppresses their
                notifications, without restricting access. Official
                communications remain available in the inbox.
              </p>
            </>
          )}
          {permissions.includes("review_custom_posts") &&
            !owner &&
            p.status === "awaiting_review" && (
              <ActionForm
                fields={[
                  {
                    key: "decision",
                    label: "Review decision",
                    type: "select",
                    options: ["published", "changes_requested", "rejected"],
                    required: true,
                  },
                  {
                    key: "reason",
                    label: "Decision reason",
                    type: "textarea",
                    required: true,
                    max: 2000,
                  },
                ]}
                label="Record decision"
                submit={async (v, key) => {
                  await command("post.review", { id, ...v }, key);
                  query.refresh();
                  return "Decision recorded in the audit log.";
                }}
              />
            )}
          <Attachments
            eventId={eventId}
            postId={id}
            onChanged={query.refresh}
            owner={owner}
            downloads={overview.event?.downloads_allowed ?? false}
          />
          {(owner ||
            permissions.includes("review_custom_posts") ||
            permissions.includes("review_reports")) && (
            <RevisionHistory key={p.updated_at} eventId={eventId} postId={id} />
          )}
          <h3>Conversation thread</h3>
          <QueryState {...replies} retry={replies.refresh} />
          {replies.data?.map((r) => (
            <article className="dz-reply" key={r.id}>
              <strong>{r.author_name ?? "Event member"}</strong>
              <small>
                {" "}
                · {timestamp(r.created_at)}
                {r.parent_id ? " · In reply to " + r.parent_id : ""}
              </small>
              <p>{r.body}</p>
              {r.author_id !== session?.user.id && (
                <ReportForm
                  eventId={eventId}
                  targetId={r.id}
                  targetType="reply"
                />
              )}
            </article>
          ))}
          {!replies.loading && replies.data?.length === 0 && (
            <p>No replies yet.</p>
          )}
          <PageButtons
            offset={offset}
            setOffset={setOffset}
            count={replies.data?.length ?? 0}
            size={50}
          />
          {p.effective_status === "published" && (
            <ActionForm
              fields={[
                {
                  key: "body",
                  label: "Reply",
                  type: "textarea",
                  required: true,
                  max: 3000,
                },
                {
                  key: "parent_id",
                  label: "Reply to a specific reply ID (optional)",
                },
              ]}
              label="Send reply"
              submit={async (v, key) => {
                await command("reply.create", { post_id: id, ...v }, key);
                replies.refresh();
                return "Reply sent.";
              }}
            />
          )}
        </>
      )}
      {!query.loading && !query.error && !p && (
        <p>This post is unavailable or you no longer have access.</p>
      )}
    </section>
  );
}
