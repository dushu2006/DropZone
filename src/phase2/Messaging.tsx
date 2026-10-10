import { useCallback, useEffect, useState } from "react";
import { errorText, useApi, useQuery, timestamp } from "./api";
import type { Data, Overview } from "./api";
import { ActionForm, PageButtons, QueryState } from "./forms";
export function Conversations({
  eventId,
  initialId,
}: {
  eventId: string;
  initialId?: string;
}) {
  const { command } = useApi(eventId),
    [selected, setSelected] = useState(initialId ?? ""),
    [offset, setOffset] = useState(0),
    [messageOffset, setMessageOffset] = useState(0);
  const q = useQuery<Data[]>(eventId, "conversations", { offset }),
    messages = useQuery<Data[]>(eventId, "messages", {
      id: selected || "00000000-0000-0000-0000-000000000000",
      offset: messageOffset,
    });
  return (
    <section className="workspace-panel">
      <h2>Private organizer conversations</h2>
      <p>
        Only you and event staff with the explicit participant-management grant
        can read your conversation. No email or push delivery is implied.
      </p>
      <QueryState {...q} retry={q.refresh} />
      {q.data?.map((c) => (
        <button
          key={String(c.id)}
          className="dz-conversation"
          onClick={() => {
            setSelected(String(c.id));
            setMessageOffset(0);
          }}
        >
          <strong>{String(c.subject)}</strong>
          <span>
            {String(c.participant_name ?? "Event member")} ·{" "}
            {timestamp(String(c.updated_at))} ·{" "}
            {c.read_at
              ? "Last read " + timestamp(String(c.read_at))
              : "Not marked read"}
          </span>
        </button>
      ))}
      {q.data?.length === 0 && <p>No private conversations yet.</p>}
      <PageButtons
        offset={offset}
        setOffset={setOffset}
        count={q.data?.length ?? 0}
      />
      {selected && (
        <>
          <h3>Selected conversation</h3>
          <QueryState {...messages} retry={messages.refresh} />
          {messages.data?.map((m) => (
            <article className="dz-reply" key={String(m.id)}>
              <strong>{String(m.sender_name ?? "Event member")}</strong>
              <small> · {timestamp(String(m.created_at))}</small>
              <p>{String(m.body)}</p>
            </article>
          ))}
          <PageButtons
            offset={messageOffset}
            setOffset={setMessageOffset}
            count={messages.data?.length ?? 0}
            size={50}
          />
          <ActionForm
            fields={[]}
            requestScope={{ selected }}
            label="Mark this conversation read"
            submit={async (_, key) => {
              await command("conversation.read", { id: selected }, key);
              q.refresh();
            }}
          />
          <ActionForm
            fields={[
              {
                key: "body",
                label: "Private reply",
                type: "textarea",
                required: true,
                max: 3000,
              },
            ]}
            requestScope={{ selected }}
            label="Send private reply"
            submit={async (v, key) => {
              await command(
                "message.send",
                { ...v, conversation_id: selected },
                key,
              );
              messages.refresh();
              q.refresh();
              return "Message sent and persisted.";
            }}
          />
        </>
      )}
      <details>
        <summary>Start a private conversation</summary>
        <ActionForm
          fields={[
            { key: "subject", label: "Subject", required: true, max: 160 },
            {
              key: "body",
              label: "Message to organizers",
              type: "textarea",
              required: true,
              max: 3000,
            },
          ]}
          label="Send to organizers"
          submit={async (v, key) => {
            const r = await command("conversation.create", v, key);
            setSelected(String(r.conversation_id));
            q.refresh();
            return "Conversation created and message sent.";
          }}
        />
      </details>
    </section>
  );
}
export function Communications({
  eventId,
  overview,
  canSend,
}: {
  eventId: string;
  overview: Overview;
  canSend: boolean;
}) {
  const { command } = useApi(eventId),
    [offset, setOffset] = useState(0),
    q = useQuery<Data[]>(eventId, "communications", { offset }),
    [scope, setScope] = useState("event"),
    [targets, setTargets] = useState<string[]>([]);
  return (
    <section className="workspace-panel">
      <h2>Official communications</h2>
      <QueryState {...q} retry={q.refresh} />
      {q.data?.map((c) => (
        <article key={String(c.id)} className="dz-post">
          <span className="dz-badge">
            {String(c.kind).replaceAll("_", " ")}
          </span>
          <h3>{String(c.title)}</h3>
          <p>{String(c.body)}</p>
          <small>
            {String(c.sender_name ?? "Event staff")} ·{" "}
            {timestamp(String(c.created_at))} · In-app delivery
          </small>
        </article>
      ))}
      {q.data?.length === 0 && <p>No official communications available.</p>}
      <PageButtons
        offset={offset}
        setOffset={setOffset}
        count={q.data?.length ?? 0}
      />
      {canSend && (
        <>
          <h3>Send official communication</h3>
          <label className="auth-field">
            <span>Audience</span>
            <select
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setTargets([]);
              }}
            >
              <option value="event">All active participants</option>
              <option value="teams">Selected teams</option>
              <option value="participant">One participant</option>
            </select>
          </label>
          {scope === "teams" && (
            <fieldset>
              <legend>Teams</legend>
              {overview.teams.map((t) => (
                <label className="dz-checkbox" key={t.id}>
                  <input
                    type="checkbox"
                    checked={targets.includes(t.id)}
                    onChange={(e) =>
                      setTargets((old) =>
                        e.target.checked
                          ? [...old, t.id]
                          : old.filter((id) => id !== t.id),
                      )
                    }
                  />
                  {t.name}
                </label>
              ))}
            </fieldset>
          )}
          {scope === "participant" && (
            <label className="auth-field">
              <span>Participant</span>
              <select
                value={targets[0] ?? ""}
                onChange={(e) => setTargets([e.target.value])}
              >
                <option value="">Select…</option>
                {overview.memberships
                  .filter(
                    (m) => m.role === "participant" && m.status === "active",
                  )
                  .map((m) => (
                    <option value={m.user_id} key={m.user_id}>
                      {m.display_name ?? m.user_id}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <ActionForm
            requestScope={{ scope, targets }}
            fields={[
              {
                key: "kind",
                label: "Communication type",
                type: "select",
                options: [
                  "announcement",
                  "schedule_update",
                  "contact",
                  "official_promotion",
                  "community_notice",
                ],
                required: true,
              },
              { key: "title", label: "Title", required: true, max: 160 },
              {
                key: "body",
                label: "Communication body",
                type: "textarea",
                required: true,
                max: 5000,
              },
            ]}
            label="Send in-app communication"
            submit={async (v, key) => {
              const r = await command(
                "communication.send",
                { ...v, scope, targets },
                key,
              );
              q.refresh();
              return `Delivered in-app to ${r.recipients} eligible recipients. No external email was sent.`;
            }}
          />
          <p>
            Recipients are resolved from active event/team memberships at send
            time. Later team changes do not retroactively change this recipient
            snapshot; revoked event membership still removes access.
          </p>
        </>
      )}
    </section>
  );
}
export function Notifications({
  eventId,
  navigate,
  refresh,
}: {
  eventId: string;
  navigate: (page: string, id?: string) => void;
  refresh: () => void;
}) {
  const { command, read } = useApi(eventId);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Data[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refreshNotifications = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await read<Data[]>("notifications", { offset });
      setData(Array.isArray(next) ? next : []);
    } catch (caught) {
      setData([]);
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }, [offset, read]);
  useEffect(() => {
    void refreshNotifications();
  }, [refreshNotifications]);
  return (
    <section className="workspace-panel">
      <h2>In-app notifications</h2>
      <p>Opening this page does not mark anything read.</p>
      <QueryState loading={loading} error={error} retry={refreshNotifications} />
      {data?.map((n) => (
        <article className="dz-post" key={String(n.id)}>
          <span className="dz-badge">{n.read_at ? "Read" : "Unread"}</span>
          <h3>{String(n.title)}</h3>
          <small>{timestamp(String(n.created_at))}</small>
          <div className="dz-actions">
            <button
              className="secondary-button"
              onClick={() => {
                const k = String(n.kind),
                  id = String(n.destination_id ?? n.resource_id);
                navigate(
                  k === "message"
                    ? "conversations"
                    : k === "communication"
                      ? "communications"
                      : k === "reply" || k === "post_decision"
                        ? "post"
                        : "safety",
                  id,
                );
              }}
            >
              Open authorized resource
            </button>
            {!n.read_at && (
              <ActionForm
                fields={[]}
                label="Mark read"
                submit={async (_, key) => {
                  await command("notification.read", { id: n.id }, key);
                  await refreshNotifications();
                  refresh();
                }}
              />
            )}
          </div>
        </article>
      ))}
      {data?.length === 0 && !loading && !error && (
        <p>
          No notifications yet. Notifications appear only after real activity.
        </p>
      )}
      <PageButtons
        offset={offset}
        setOffset={setOffset}
        count={data?.length ?? 0}
      />
    </section>
  );
}
