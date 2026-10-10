import { useEffect, useState } from "react";
import { errorText, useApi, useQuery } from "./api";
import { imageMime } from "../../supabase/functions/_shared/image";
import { QueryState } from "./forms";
export async function validateImage(file: File) {
  if (file.size === 0 || file.size > 5242880)
    throw new Error("Images must be between 1 byte and 5 MB.");
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const mime = imageMime(b);
  if (!mime || (file.type && file.type !== mime))
    throw new Error(
      "Only JPEG, PNG and WebP images with matching file signatures are accepted. SVG, PDF and executable files are not accepted.",
    );
  return mime;
}
type Attachment = {
  id: string;
  object_path: string;
  status: string;
  mime: string;
  size_bytes: number;
};
function ImageView({
  path,
  eventId,
  downloads,
}: {
  path: string;
  eventId: string;
  downloads: boolean;
}) {
  const { client } = useApi(eventId),
    [url, setUrl] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      objectUrl = "";
    client.storage
      .from("event-attachments")
      .download(path)
      .then(({ data, error }) => {
        if (error) {
          if (active) setError(errorText(error));
          return;
        }
        if (data && active) {
          objectUrl = URL.createObjectURL(data);
          setUrl(objectUrl);
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, path]);
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {url ? (
        <>
          <img
            className="dz-attachment"
            src={url}
            alt="Attachment uploaded by the post author"
          />
          {downloads && (
            <a href={url} download="dropzone-image">
              Download image
            </a>
          )}
        </>
      ) : (
        !error && <p>Loading protected image…</p>
      )}
    </>
  );
}
export function Attachments({
  eventId,
  postId,
  owner,
  downloads,
}: {
  eventId: string;
  postId: string;
  owner: boolean;
  downloads: boolean;
}) {
  const { command, client } = useApi(eventId),
    query = useQuery<Attachment[]>(eventId, "attachments", { id: postId });
  const [file, setFile] = useState<File | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  // Retain reserved path after a failure so Retry does not create another metadata row.
  const [reserved, setReserved] = useState<Attachment | null>(null);
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const mime = await validateImage(file);
      const a =
        reserved ??
        (await command<Attachment>("attachment.reserve", {
          post_id: postId,
          mime,
          size_bytes: file.size,
        }));
      setReserved(a);
      const { error: uploadError } = await client.storage
        .from("event-attachments")
        .upload(a.object_path, file, { contentType: mime, upsert: false });
      // A duplicate object can be the result of an interrupted successful upload; finalize independently verifies its metadata.
      if (uploadError && !/already exists|duplicate/i.test(uploadError.message))
        throw uploadError;
      const verified = await client.functions.invoke("verify-attachment", {
        body: { event_id: eventId, post_id: postId, attachment_id: a.id },
      });
      if (verified.error || !verified.data?.verified)
        throw new Error(
          verified.data?.error ||
            "Server-side image verification failed. Ensure the verify-attachment Supabase function is configured, then retry.",
        );
      await command("attachment.finalize", { id: a.id });
      setNotice("File uploaded to private Supabase Storage.");
      setReserved(null);
      setFile(null);
      query.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="dz-attachments">
      <h3>Private attachments</h3>
      <QueryState {...query} retry={query.refresh} />
      {query.data?.map((a) => (
        <div key={a.id}>
          {a.status === "ready" ? (
            <ImageView
              eventId={eventId}
              path={a.object_path}
              downloads={downloads}
            />
          ) : (
            <p>
              {a.status} attachment · {a.size_bytes} bytes
            </p>
          )}
          {owner && a.status !== "deleted" && (
            <button
              className="secondary-button"
              onClick={() => {
                void command("attachment.delete", { id: a.id })
                  .then(query.refresh)
                  .catch((e) => setError(errorText(e)));
              }}
            >
              Remove attachment
            </button>
          )}
        </div>
      ))}
      {owner && (
        <>
          <label className="auth-field">
            <span>Add image (JPEG, PNG or WebP, maximum 5 MB)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setReserved(null);
                setNotice("");
              }}
            />
          </label>
          <button
            className="secondary-button"
            disabled={!file || busy}
            onClick={() => void upload()}
          >
            {busy ? "Uploading…" : "Upload / retry"}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!downloads && (
        <p>
          Download actions are disabled by this event. Browser viewing cannot
          prevent screenshots, recording or copying image bytes.
        </p>
      )}
    </section>
  );
}
