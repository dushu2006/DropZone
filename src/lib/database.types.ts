export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];
export type EventMembershipAccess = {
  event_id: string;
  event_name: string;
  event_slug: string;
  role: "participant" | "organizer" | "moderator";
  permissions: string[];
  status: "active";
};
export type TrustedAccess = {
  user_id: string;
  display_name: string | null;
  memberships: EventMembershipAccess[];
};
type Rpc<A, R> = { Args: A; Returns: R };
export type Database = {
  public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
    Functions: {
      update_my_profile: Rpc<{ p_name: string }, undefined>;
      get_my_access: Rpc<Record<string, never>, Json>;
      accept_event_invitation: Rpc<{ p_token: string }, { event_id: string }>;
      create_event_invitation: Rpc<
        {
          p_event_id: string;
          p_token: string;
          p_expires_at?: string;
          p_max_uses?: number;
        },
        Json
      >;
      manage_event_membership: Rpc<
        {
          p_event_id: string;
          p_user_id: string;
          p_role: string;
          p_permissions: string[];
        },
        undefined
      >;
      revoke_event_membership: Rpc<
        { p_event_id: string; p_user_id: string },
        undefined
      >;
      dz_read: Rpc<{ p_event: string; p_kind: string; p_filter?: Json }, Json>;
      dz_command: Rpc<
        { p_event: string; p_action: string; p_data: Json; p_request: string },
        Json
      >;
      check_zone_location: Rpc<
        { p_zone: string; p_lon: number; p_lat: number; p_accuracy: number },
        boolean
      >;
    };
  };
};
