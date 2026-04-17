import { backendRoot } from "@/lib/backendUrl";
import { createClient } from "@/lib/supabase/server";

async function getToken(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function requestServer<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${backendRoot}${path}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text();
    }
    throw new Error(typeof detail === "string" ? detail : `API Error ${res.status}: ${path}`);
  }

  return res.json() as Promise<T>;
}

export async function getCurrentProfile<T = {
  id: number;
  auth_user_id: string;
  display_name: string;
  email: string;
  avatar_url?: string | null;
  role: string;
  phone?: string | null;
  city?: string | null;
  bio?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}>(): Promise<T | null> {
  try {
    return await requestServer<T>("/profiles/me");
  } catch {
    return null;
  }
}

export function resolveProfile<T = unknown>(identifier: string | number): Promise<T> {
  return requestServer<T>(`/profiles/resolve/${encodeURIComponent(String(identifier))}`);
}

export function listProfiles<T = unknown>(): Promise<T> {
  return requestServer<T>("/profiles/all");
}
