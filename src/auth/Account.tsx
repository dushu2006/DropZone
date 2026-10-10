import { Link } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { useAccess } from "../phase1/AccessProvider";
import { ActionForm } from "../phase2/forms";
export function PrivacyNotice() {
  return (
    <main className="auth-page">
      <section className="auth-card config-card">
        <h1>DropZone privacy</h1>
        <p>
          DropZone uses Supabase to store your account, event memberships,
          posts, replies, notifications and private files. Authorized event
          staff can review content according to explicit permissions.
        </p>
        <p>
          Only you and staff assigned participant management can access your
          organizer conversations. Reports and roster emails are restricted.
          Official messages are in-app; we do not claim external email or push
          delivery.
        </p>
        <p>
          Location is requested only for optional map centering or
          event-required posting checks. The supplied coordinates are checked
          then discarded, not retained as location history. GPS can be
          inaccurate or spoofed. Map tile providers receive your IP address and
          the map area you view.
        </p>
        <p>
          Attachments may contain camera metadata, including GPS EXIF. Avoid
          uploading sensitive images. Download controls cannot prevent
          screenshots, recording or copying previously received bytes.
        </p>
        <p>
          Deleted text is eligible for redaction after 30 days. Archived event
          content and private conversations/rosters have a 180-day retention
          period. Notifications expire after 90 days; retry receipts after 7
          days. Maintenance scheduling is required. Moderation/security audits
          and backups may retain information. Contact your event operator for
          account anonymization or deletion requests; complete immediate erasure
          is not promised.
        </p>
        <Link to="/app/account">Account settings</Link> ·{" "}
        <Link to="/">DropZone home</Link>
      </section>
    </main>
  );
}
export function AccountSettings() {
  const { client, session } = useAuth(),
    { access, refreshAccess } = useAccess();
  return (
    <main className="auth-page">
      <section className="auth-card config-card">
        <h1>Account settings</h1>
        <p>{session?.user.email}</p>
        <ActionForm
          initial={{ display_name: access?.display_name ?? "" }}
          fields={[
            {
              key: "display_name",
              label: "Display name",
              required: true,
              max: 80,
            },
          ]}
          submit={async (v) => {
            const { error } = await client.rpc("update_my_profile", {
              p_name: v.display_name,
            });
            if (error) throw error;
            await refreshAccess();
            return "Profile updated.";
          }}
        />
        <Link to="/recovery">Request a secure password reset</Link>
        <p>
          Changing your profile never changes event roles or permissions.
          Contact your event operator for account anonymization/deletion; audit
          and backup retention may apply.
        </p>
        <Link to="/privacy">Privacy notice</Link> ·{" "}
        <Link to="/app">Back to events</Link>
      </section>
    </main>
  );
}
