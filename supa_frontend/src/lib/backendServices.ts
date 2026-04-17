"use client";

import { createClient } from "@/lib/supabase/client";
import { backendRoot } from "@/lib/backendUrl";

type ProfileResponse = {
  id: number;
  auth_user_id: string;
  display_name: string;
  email: string;
  avatar_url?: string | null;
  role: string;
  professional_role?: string | null;
  phone?: string | null;
  city?: string | null;
  bio?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

type SessionSnapshot = {
  userId: string | null;
  token: string | null;
};

async function getSessionSnapshot(): Promise<SessionSnapshot> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return {
    userId: data.session?.user?.id ?? null,
    token: data.session?.access_token ?? null,
  };
}

function buildRequestHeaders(init: RequestInit, token: string | null): Headers {
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function requestWithToken<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${backendRoot}${path}`, {
    ...init,
    headers: buildRequestHeaders(init, token),
  });

  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text();
    }
    const message = typeof detail === "string" ? detail : `API Error ${res.status}: ${path}`;
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { token } = await getSessionSnapshot();
  return requestWithToken<T>(path, token, init);
}

let profilesMeCache: { userId: string; data: ProfileResponse } | null = null;
let profilesMeInFlight: { userId: string; promise: Promise<ProfileResponse> } | null = null;

async function requestProfileMe(force = false): Promise<ProfileResponse> {
  const { token, userId } = await getSessionSnapshot();
  if (!userId) {
    throw new Error("Not authenticated");
  }

  if (!force && profilesMeCache?.userId === userId) {
    return profilesMeCache.data;
  }

  if (!force && profilesMeInFlight?.userId === userId) {
    return profilesMeInFlight.promise;
  }

  const promise = requestWithToken<ProfileResponse>("/profiles/me", token);
  profilesMeInFlight = { userId, promise };

  try {
    const data = await promise;
    const latestSession = await getSessionSnapshot();
    if (latestSession.userId === userId) {
      profilesMeCache = { userId, data };
    }
    return data;
  } finally {
    if (profilesMeInFlight?.promise === promise) {
      profilesMeInFlight = null;
    }
  }
}

function clearProfileMeCache(): void {
  profilesMeCache = null;
  profilesMeInFlight = null;
}

export const profilesApi = {
  me: (options?: { force?: boolean }) => requestProfileMe(Boolean(options?.force)),

  clearCache: () => {
    clearProfileMeCache();
  },

  resolve: (identifier: string | number) =>
    request<{
      id: number;
      auth_user_id: string;
      display_name: string;
      email: string;
      avatar_url?: string | null;
      role: string;
      professional_role?: string | null;
      phone?: string | null;
      city?: string | null;
      bio?: string | null;
      is_active: boolean;
      created_at?: string;
      updated_at?: string;
    }>(`/profiles/resolve/${encodeURIComponent(String(identifier))}`),

  batch: (ids: number[]) =>
    request<Array<{
      id: number;
      auth_user_id: string;
      display_name: string;
      email: string;
      avatar_url?: string | null;
      role: string;
      professional_role?: string | null;
      phone?: string | null;
      city?: string | null;
      bio?: string | null;
      is_active: boolean;
      created_at?: string;
      updated_at?: string;
    }>>("/profiles/batch", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

  all: () =>
    request<Array<{
      id: number;
      auth_user_id: string;
      display_name: string;
      email: string;
      avatar_url?: string | null;
      role: string;
      professional_role?: string | null;
      phone?: string | null;
      city?: string | null;
      bio?: string | null;
      is_active: boolean;
      created_at?: string;
      updated_at?: string;
    }>>("/profiles/all"),

  updateRole: (profileId: number, role: string) =>
    request<{
      id: number;
      auth_user_id: string;
      display_name: string;
      email: string;
      avatar_url?: string | null;
      role: string;
      professional_role?: string | null;
      phone?: string | null;
      city?: string | null;
      bio?: string | null;
      is_active: boolean;
      created_at?: string;
      updated_at?: string;
    }>(`/profiles/${profileId}/role`, {
      method: "PUT",
      body: JSON.stringify({ role }),
    }).then((response) => {
      clearProfileMeCache();
      return response;
    }),
};

export const pdfsApi = {
  list: () =>
    request<Array<{
      id: number;
      filename: string;
      extracted_text: string;
      page_count?: number | null;
      used_ocr: boolean;
      created_at: string;
      expires_at?: string | null;
      status?: string;
      user_id?: number;
    }>>("/pdfs/"),
};
