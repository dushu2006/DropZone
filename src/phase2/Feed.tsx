import { useState, useEffect } from "react";
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
    <section className="workspace-panel">
      <h2>
        {revision
          ? revision.status === "published"
            ? "Edit post"
            : "Revise submission"
          : "Create a post"}
      </h2>
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
      <p>{template.description}</p>
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
}: {
  eventId: string;
  mode: "feed" | "activity" | "review";
  open: (id: string) => void;
  zones: Overview["zones"];
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
    <section className="workspace-panel">
      <div className="dz-section-heading">
        <h2>
          {mode === "feed"
            ? "Community"
            : mode === "activity"
              ? "My activity"
              : "Custom & promotion review"}
        </h2>
        <button
          className="secondary-button"
          onClick={() => {
            setOffset(0);
            setCursors([]);
            query.refresh();
          }}
        >
          Refresh
        </button>
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
      {Array.isArray(query.data) &&
        query.data.map((p) => (
          <article className="dz-post" key={p.id}>
            <span className="dz-badge">
              {p.category.replaceAll("_", " ")} · {p.effective_status}
            </span>
            <h3>
              <button className="dz-title-button" onClick={() => open(p.id)}>
                {p.title}
              </button>
            </h3>
            <p>{p.body}</p>
            <small>
              {p.author_name ?? "Event member"} · {timestamp(p.created_at)} ·
              Expires {timestamp(p.expires_at)}
            </small>
          </article>
        ))}
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
