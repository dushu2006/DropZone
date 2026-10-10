import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import type { Json } from "../lib/database.types";
export type Data = Record<string, Json | undefined>;
export function errorText(error: unknown) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "The operation could not be completed.";
  return /fetch|network/i.test(message)
    ? "Could not reach Supabase. Your input has been kept; check your connection and retry."
    : message;
}
export function useApi(eventId: string) {
  const { client, session } = useAuth();
  const read = useCallback(
    async <T>(kind: string, filter: Data = {}): Promise<T> => {
      const { data, error } = await client.rpc("dz_read", {
        p_event: eventId,
        p_kind: kind,
        p_filter: filter,
      });
      if (error) {
        if (error.code === "42501" || error.code === "PGRST301")
          window.dispatchEvent(new Event("dropzone:access-invalidated"));
        throw error;
      }
      return data as T;
    },
    [client, eventId, session?.user.id],
  );
  const command = useCallback(
    async <T = Data>(
      action: string,
      data: Data,
      request: string = crypto.randomUUID(),
    ): Promise<T> => {
      const result = await client.rpc("dz_command", {
        p_event: eventId,
        p_action: action,
        p_data: data,
        p_request: request,
      });
      if (result.error) {
        if (result.error.code === "42501" || result.error.code === "PGRST301")
          window.dispatchEvent(new Event("dropzone:access-invalidated"));
        throw result.error;
      }
      return result.data as T;
    },
    [client, eventId, session?.user.id],
  );
  return { read, command, client };
}
export function useQuery<T>(eventId: string, kind: string, filter: Data = {}) {
  const { read } = useApi(eventId);
  const { session } = useAuth();
  const [data, setData] = useState<T | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const key = JSON.stringify(filter);
  const identity = JSON.stringify([session?.user.id, eventId, kind, key]);
  const [loadedIdentity, setLoadedIdentity] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    setData(null);
    read<T>(kind, JSON.parse(key))
      .then((value) => {
        if (current === generation.current) {
          setData(value);
          setLoadedIdentity(identity);
        }
      })
      .catch((e) => {
        if (current === generation.current) setError(errorText(e));
      })
      .finally(() => {
        if (current === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [read, kind, key, version, identity]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "hidden") setVersion((v) => v + 1);
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  return {
    data: loadedIdentity === identity ? data : null,
    loading,
    error,
    refresh: () => setVersion((v) => v + 1),
  };
}
export type Post = {
  id: string;
  author_id: string;
  author_name: string | null;
  title: string;
  body: string;
  category: string;
  fields: Data;
  status: string;
  effective_status: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  reviewed_at?: string | null;
  zone_id: string | null;
  decision_reason: string | null;
};
export type Zone = {
  id: string;
  name: string;
  boundary_type: "circle" | "polygon";
  radius_meters: number | null;
  geometry: GeoJSON.Geometry;
};
export type Member = {
  user_id: string;
  display_name: string | null;
  role: string;
  permissions: string[];
  status: string;
};
export type Overview = {
  event: {
    id: string;
    name: string;
    description: string;
    status: string;
    starts_at: string | null;
    ends_at: string | null;
    location_required: boolean;
    max_accuracy_meters: number;
    downloads_allowed: boolean;
  } | null;
  zones: Zone[];
  teams: { id: string; name: string }[];
  memberships: Member[];
  team_memberships: { team_id: string; user_id: string }[];
  unread: number;
  active_posts: number;
  preferences: { target_id: string; blocked: boolean; muted: boolean }[];
};
export function timestamp(value: string) {
  return new Date(value).toLocaleString();
}
