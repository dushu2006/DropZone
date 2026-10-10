import { useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { errorText } from "./api";
export type Field = {
  key: string;
  label: string;
  type?: "text" | "textarea" | "number" | "datetime-local" | "email" | "select";
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
};
export function FieldInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string;
  onChange: (value: string) => void;
}) {
  const props = {
    value,
    onChange: (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => onChange(e.target.value),
    required: field.required,
    maxLength: field.max ?? 1000,
  };
  return (
    <label className="auth-field">
      <span>
        {field.label}
        {field.required ? " *" : ""}
      </span>
      {field.type === "textarea" ? (
        <textarea {...props} rows={4} />
      ) : field.type === "select" ? (
        <select {...props}>
          <option value="">Select…</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...props}
          type={field.type ?? "text"}
          step={field.type === "number" ? "any" : undefined}
          min={field.min}
          max={field.type === "number" ? field.max : undefined}
        />
      )}
    </label>
  );
}
export function ActionForm({
  fields,
  initial = {},
  submit,
  label = "Save",
  children,
  onSuccess,
  requestScope = null,
}: {
  fields: Field[];
  initial?: Record<string, string>;
  submit: (values: Record<string, string>, request: string) => Promise<unknown>;
  label?: string;
  children?: ReactNode;
  onSuccess?: () => void;
  requestScope?: unknown;
}) {
  const [values, setValues] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const attempt = useRef({ key: "", id: crypto.randomUUID() });
  const send = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const key = JSON.stringify({ values, requestScope });
    if (attempt.current.key !== key)
      attempt.current = { key, id: crypto.randomUUID() };
    try {
      const result = await submit(values, attempt.current.id);
      setNotice(typeof result === "string" ? result : "Saved successfully.");
      onSuccess?.();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="auth-form dz-form" onSubmit={send}>
      {fields.map((f) => (
        <FieldInput
          key={f.key}
          field={f}
          value={values[f.key] ?? ""}
          onChange={(v) => {
            setValues((old) => ({ ...old, [f.key]: v }));
            setNotice("");
          }}
        />
      ))}
      {children}
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="auth-success">
          {notice}
        </p>
      )}
      <button className="primary-button" disabled={busy} type="submit">
        {busy ? (/^Send/.test(label) ? "Sending…" : "Saving…") : label}
      </button>
    </form>
  );
}
export function QueryState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
}) {
  if (loading) return <p role="status">Loading authorized records…</p>;
  if (error)
    return (
      <div role="alert" className="auth-error">
        {error}{" "}
        <button className="secondary-button" onClick={retry}>
          Retry
        </button>
      </div>
    );
  return null;
}
export function PageButtons({
  offset,
  count,
  setOffset,
  size = 30,
}: {
  offset: number;
  count: number;
  setOffset: (value: number) => void;
  size?: number;
}) {
  return (
    <div className="dz-actions">
      <button
        className="secondary-button"
        disabled={offset === 0}
        onClick={() => setOffset(Math.max(0, offset - size))}
      >
        Previous
      </button>
      <span>Page {Math.floor(offset / size) + 1}</span>
      <button
        className="secondary-button"
        disabled={count < size}
        onClick={() => setOffset(offset + size)}
      >
        Next
      </button>
    </div>
  );
}
