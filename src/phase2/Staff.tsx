import { useRef, useState } from "react";
import { useAccess } from "../phase1/AccessProvider";
import { useApi, useQuery, errorText, timestamp } from "./api";
import type { Overview, Data } from "./api";
import { ActionForm, PageButtons, QueryState } from "./forms";
import { parseRoster, safeCsvCell } from "./roster";
import type { RosterRow } from "./roster";
function localDate(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function EventSettings({
  eventId,
  overview,
  refresh,
}: {
  eventId: string;
  overview: Overview;
  refresh: () => void;
}) {
  const { command } = useApi(eventId),
    { refreshAccess } = useAccess(),
    e = overview.event;
  if (!e) return null;
  return (
    <section className="workspace-panel">
      <h2>Event configuration</h2>
      <ActionForm
        initial={{
          name: e.name,
          description: e.description ?? "",
          starts_at: localDate(e.starts_at),
          ends_at: localDate(e.ends_at),
          status: e.status,
          location_required: String(e.location_required),
          max_accuracy_meters: String(e.max_accuracy_meters),
          downloads_allowed: String(e.downloads_allowed),
        }}
        fields={[
          { key: "name", label: "Event name", required: true, max: 120 },
          {
            key: "description",
            label: "Description",
            type: "textarea",
            max: 5000,
          },
          {
            key: "starts_at",
            label: "Start (local time)",
            type: "datetime-local",
          },
          { key: "ends_at", label: "End (local time)", type: "datetime-local" },
          {
            key: "status",
            label: "Event status",
            type: "select",
            options: ["active", "archived"],
            required: true,
          },
          {
            key: "location_required",
            label: "Require location when posting",
            type: "select",
            options: ["true", "false"],
            required: true,
          },
          {
            key: "max_accuracy_meters",
            label: "Maximum location uncertainty (meters)",
            type: "number",
            min: 5,
            max: 500,
            required: true,
          },
          {
            key: "downloads_allowed",
            label: "Show attachment download actions",
            type: "select",
            options: ["true", "false"],
            required: true,
          },
        ]}
        submit={async (v, key) => {
          await command(
            "event.update",
            {
              ...v,
              starts_at: v.starts_at
                ? new Date(v.starts_at).toISOString()
                : null,
              ends_at: v.ends_at ? new Date(v.ends_at).toISOString() : null,
            },
            key,
          );
          refresh();
          await refreshAccess();
          return "Event configuration saved.";
        }}
      />
      <h3>Create another event</h3>
      <p>
        Your existing explicit grants—not a selected role—authorize creation.
        Only your current grants carry to the new event.
      </p>
      <ActionForm
        fields={[
          { key: "name", label: "New event name", required: true, max: 120 },
          { key: "slug", label: "Unique event slug", required: true },
          {
            key: "description",
            label: "New event description",
            type: "textarea",
            max: 5000,
          },
        ]}
        label="Create event"
        submit={async (v, key) => {
          await command("event.create", v, key);
          await refreshAccess();
          return "Event created. Open My events to select it.";
        }}
      />
    </section>
  );
}
export function Teams({
  eventId,
  overview,
  permissions,
  refresh,
}: {
  eventId: string;
  overview: Overview;
  permissions: string[];
  refresh: () => void;
}) {
  const { command, client } = useApi(eventId),
    [team, setTeam] = useState(""),
    [member, setMember] = useState("");
  return (
    <section className="workspace-panel">
      <h2>Participants & teams</h2>
      <p>
        {overview.memberships.filter((m) => m.status === "active").length}{" "}
        active memberships visible with your permissions. Roster entries are
        separate from registered accounts.
      </p>
      {overview.teams.map((t) => (
        <article className="dz-post" key={t.id}>
          <h3>{t.name}</h3>
          <ul>
            {overview.team_memberships
              .filter((m) => m.team_id === t.id)
              .map((m) => (
                <li key={m.user_id}>
                  {overview.memberships.find((u) => u.user_id === m.user_id)
                    ?.display_name ?? m.user_id}
                </li>
              ))}
          </ul>
        </article>
      ))}
      {permissions.includes("manage_teams") && (
        <>
          <label className="auth-field">
            <span>Team to edit</span>
            <select value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">New team</option>
              {overview.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <ActionForm
            key={team}
            initial={{
              name: overview.teams.find((t) => t.id === team)?.name ?? "",
            }}
            fields={[
              { key: "name", label: "Team name", required: true, max: 100 },
            ]}
            submit={async (v, key) => {
              await command("team.save", { id: team || null, ...v }, key);
              refresh();
            }}
          />
          <label className="auth-field">
            <span>Participant to assign</span>
            <select value={member} onChange={(e) => setMember(e.target.value)}>
              <option value="">Choose participant</option>
              {overview.memberships
                .filter(
                  (m) => m.role === "participant" && m.status === "active",
                )
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name ?? m.user_id}
                  </option>
                ))}
            </select>
          </label>
          <ActionForm
            fields={[]}
            requestScope={{ team, member }}
            label={team ? "Assign to selected team" : "Remove team assignment"}
            submit={async (_, key) => {
              if (!member) throw new Error("Select a participant.");
              await command(
                "team.assign",
                { user_id: member, team_id: team || null },
                key,
              );
              refresh();
            }}
          />
        </>
      )}
      {permissions.includes("manage_roles") && (
        <details>
          <summary>Trusted staff assignments</summary>
          <p>
            You may grant only permissions you already hold; you cannot change
            your own role.
          </p>
          <ActionForm
            fields={[
              {
                key: "user_id",
                label: "Existing authenticated user UUID",
                required: true,
              },
              {
                key: "role",
                label: "Role",
                type: "select",
                options: ["participant", "organizer", "moderator"],
                required: true,
              },
              {
                key: "permissions",
                label: "Explicit permissions (comma separated)",
              },
            ]}
            submit={async (v) => {
              const { error } = await client.rpc("manage_event_membership", {
                p_event_id: eventId,
                p_user_id: v.user_id,
                p_role: v.role,
                p_permissions: (v.permissions ?? "")
                  .split(",")
                  .map((p) => p.trim())
                  .filter(Boolean),
              });
              if (error) throw error;
              refresh();
              return "Membership saved through the trusted role operation.";
            }}
          />
        </details>
      )}
      {permissions.includes("manage_members") && (
        <details>
          <summary>Revoke membership</summary>
          <ActionForm
            fields={[
              { key: "user_id", label: "User UUID to revoke", required: true },
            ]}
            label="Confirm revocation"
            submit={async (v) => {
              const { error } = await client.rpc("revoke_event_membership", {
                p_event_id: eventId,
                p_user_id: v.user_id,
              });
              if (error) throw error;
              refresh();
              return "Membership revoked.";
            }}
          />
        </details>
      )}
    </section>
  );
}
export function RosterImport({ eventId }: { eventId: string }) {
  const { command, read } = useApi(eventId),
    [rows, setRows] = useState<RosterRow[]>([]),
    [errors, setErrors] = useState<string[]>([]),
    [importError, setImportError] = useState(""),
    [rosterOffset, setRosterOffset] = useState(0),
    [importOffset, setImportOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState(""),
    key = useRef(crypto.randomUUID());
  const history = useQuery<Data[]>(eventId, "imports", {
      offset: importOffset,
    }),
    roster = useQuery<Data[]>(eventId, "roster", { offset: rosterOffset });
  const choose = async (file?: File) => {
    setRows([]);
    setErrors([]);
    setResult("");
    setImportError("");
    if (!file) return;
    setBusy(true);
    try {
      const parsed = await parseRoster(file);
      setRows(parsed.rows);
      setErrors(
        parsed.errors.length
          ? parsed.errors
          : await read<string[]>("roster_preview", { rows: parsed.rows }),
      );
      key.current = crypto.randomUUID();
    } catch (e) {
      setErrors([errorText(e)]);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    setBusy(true);
    setResult("");
    setImportError("");
    try {
      const r = await command<{
        imported: number;
        skipped: number;
        failed: number;
      }>("roster.import", { rows }, key.current);
      setResult(
        `Imported ${r.imported}; skipped ${r.skipped}; failed ${r.failed}. These are roster records, not Auth accounts or invitations.`,
      );
      setRows([]);
      history.refresh();
      roster.refresh();
    } catch (e) {
      setImportError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="workspace-panel">
      <h2>Roster import</h2>
      <p>
        CSV/XLSX, one worksheet, up to 1,000 rows / 2 MB. Columns:{" "}
        <code>email, display_name, team_name</code>. Team names are planned
        assignments, not automatic memberships. Existing-account assignment
        still requires the authorized team operation.
      </p>
      <label className="auth-field">
        <span>Choose roster file</span>
        <input
          type="file"
          accept=".csv,.xlsx"
          disabled={busy}
          onChange={(e) => void choose(e.target.files?.[0])}
        />
      </label>
      {errors.length > 0 && (
        <>
          <ul className="auth-error" role="alert">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          <button
            className="secondary-button"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob(["error\r\n" + errors.map(safeCsvCell).join("\r\n")], {
                  type: "text/csv",
                }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "roster-errors.csv";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Export safe error report
          </button>
        </>
      )}
      {rows.length > 0 && (
        <>
          <p>Preview: {rows.length} rows. Nothing has been written.</p>
          <div className="dz-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Planned team</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.email}</td>
                    <td>{r.display_name}</td>
                    <td>{r.team_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dz-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setRows([]);
                setErrors([]);
              }}
            >
              Cancel import
            </button>
            <button
              className="primary-button"
              disabled={busy || errors.length > 0}
              onClick={() => void confirm()}
            >
              {busy ? "Importing…" : "Confirm transactional import"}
            </button>
          </div>
        </>
      )}
      {importError && (
        <p className="auth-error" role="alert">
          {importError} No partial import was committed; correct the file or
          retry.
        </p>
      )}
      {result && <p role="status">{result}</p>}
      <QueryState {...history} retry={history.refresh} />
      <h3>Recent import results</h3>
      {history.data?.map((r) => (
        <p key={String(r.id)}>
          {String(r.created_at)} · Imported {String(r.imported)} · Skipped{" "}
          {String(r.skipped)}
        </p>
      ))}
      <PageButtons
        offset={importOffset}
        setOffset={setImportOffset}
        count={history.data?.length ?? 0}
      />
      <h3>Recent roster entries (not confirmed accounts)</h3>
      {roster.data?.map((r) => (
        <p key={String(r.id)}>
          {String(r.display_name)} · {String(r.email)} · {String(r.team_name)}
        </p>
      ))}
      <QueryState {...roster} retry={roster.refresh} />
      <PageButtons
        offset={rosterOffset}
        setOffset={setRosterOffset}
        count={roster.data?.length ?? 0}
        size={100}
      />
    </section>
  );
}
export function Moderation({
  eventId,
  permissions,
}: {
  eventId: string;
  permissions: string[];
}) {
  const { command } = useApi(eventId),
    [offset, setOffset] = useState(0),
    [status, setStatus] = useState("open"),
    query = useQuery<Data[]>(eventId, "reports", { status, offset });
  return (
    <section className="workspace-panel">
      <h2>Reports</h2>
      <label className="auth-field">
        <span>Review status</span>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setOffset(0);
          }}
        >
          {["open", "escalated", "dismissed", "removed", "restricted"].map(
            (s) => (
              <option key={s}>{s}</option>
            ),
          )}
        </select>
      </label>
      <QueryState {...query} retry={query.refresh} />
      {query.data?.map((r) => (
        <article className="dz-post" key={String(r.id)}>
          <h3>
            {String(r.target_type)} · {String(r.reason)}
          </h3>
          <p>{String(r.context ?? "Context no longer available")}</p>
          <p>{String(r.explanation)}</p>
          <small>
            {timestamp(String(r.created_at))} · {String(r.status)}
          </small>
          {r.decision_reason && <p>{String(r.decision_reason)}</p>}
          {["open", "escalated"].includes(String(r.status)) && (
            <ActionForm
              fields={[
                {
                  key: "decision",
                  label: "Decision",
                  type: "select",
                  options: [
                    "dismissed",
                    "escalated",
                    ...(permissions.includes("remove_content")
                      ? ["removed", "restricted"]
                      : []),
                  ],
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
              label="Record moderation action"
              submit={async (v, key) => {
                await command("report.decide", { id: r.id, ...v }, key);
                query.refresh();
                return "Decision and audit record saved.";
              }}
            />
          )}
        </article>
      ))}
      {query.data?.length === 0 && <p>No reports in this queue.</p>}
      <PageButtons
        offset={offset}
        setOffset={setOffset}
        count={query.data?.length ?? 0}
      />
    </section>
  );
}
export function Audit({ eventId }: { eventId: string }) {
  const [offset, setOffset] = useState(0),
    q = useQuery<Data[]>(eventId, "audit", { offset });
  return (
    <section className="workspace-panel">
      <h2>Audit trail</h2>
      <QueryState {...q} retry={q.refresh} />
      {q.data?.map((r) => (
        <article className="dz-post" key={String(r.id)}>
          <strong>{String(r.action)}</strong>
          <p>
            {timestamp(String(r.created_at))} · Actor{" "}
            {String(r.actor_user_id ?? "Deleted account")}
          </p>
          <pre>{JSON.stringify(r.metadata, null, 2)}</pre>
        </article>
      ))}
      <PageButtons
        offset={offset}
        setOffset={setOffset}
        count={q.data?.length ?? 0}
        size={50}
      />
    </section>
  );
}
