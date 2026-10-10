import { useState } from "react";
import { useQuery, timestamp } from "./api";
import type { Data } from "./api";
import { PageButtons, QueryState } from "./forms";
export function RevisionHistory({
  eventId,
  postId,
}: {
  eventId: string;
  postId: string;
}) {
  const [offset, setOffset] = useState(0),
    q = useQuery<Data[]>(eventId, "revisions", { id: postId, offset });
  return (
    <details>
      <summary>Revision & status history</summary>
      <QueryState {...q} retry={q.refresh} />
      {q.data?.map((r) => (
        <article className="dz-post" key={String(r.id)}>
          <strong>{String(r.title)}</strong>
          <p>{String(r.body)}</p>
          {r.decision_reason && (
            <p>Review reason: {String(r.decision_reason)}</p>
          )}
          <small>
            {timestamp(String(r.created_at))} · Previous status:{" "}
            {String(r.previous_status)}
          </small>
        </article>
      ))}
      {q.data?.length === 0 && <p>No earlier revisions.</p>}
      <PageButtons
        offset={offset}
        setOffset={setOffset}
        count={q.data?.length ?? 0}
      />
    </details>
  );
}
export function Safety({ eventId }: { eventId: string }) {
  const q = useQuery<{
    reports: Data[];
    restrictions: Data[];
    decisions: Data[];
  }>(eventId, "safety");
  return (
    <section className="workspace-panel">
      <h2>My reports & decisions</h2>
      <p>
        Reports request review, not automatic punishment. Decisions affecting
        your account do not reveal another person's reporter identity.
      </p>
      <QueryState {...q} retry={q.refresh} />
      <h3>Reports you submitted</h3>
      {q.data?.reports.map((r) => (
        <article className="dz-post" key={String(r.id)}>
          <strong>
            {String(r.reason)} · {String(r.status)}
          </strong>
          <p>{String(r.explanation)}</p>
          <p>{String(r.decision_reason ?? "No decision yet.")}</p>
        </article>
      ))}
      {q.data?.reports.length === 0 && (
        <p>You have not submitted any reports.</p>
      )}
      <h3>Decisions affecting you</h3>
      {q.data?.decisions.map((r, i) => (
        <article className="dz-post" key={i}>
          <strong>{String(r.decision)}</strong>
          <p>{String(r.reason)}</p>
          <small>{timestamp(String(r.created_at))}</small>
        </article>
      ))}
      <h3>Account restrictions in this event</h3>
      {q.data?.restrictions.map((r) => (
        <p key={String(r.user_id)}>
          {String(r.reason)} · Until {timestamp(String(r.until_at))}
        </p>
      ))}
    </section>
  );
}
