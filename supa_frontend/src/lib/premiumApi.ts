/**
 * V2 premiumApi — updated Axios client pointing to new FastAPI backend on port 8001.
 * Replaces old /api/v1/premium prefix with clean V2 routes.
 *
 * Usage: import { premiumApi, adminApi } from "@/lib/premiumApi"
 * - premiumApi  → /ai, /payments, /pdfs, /live, /analytics
 * - adminApi    → same base, used for admin-only calls
 */

import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { createClient } from "./supabase/client";
import { backendRoot } from "./backendUrl";

const supabase = createClient();

// ── Shared auth interceptor ───────────────────────────────────────────────────

const addAuthToken = async (
  config: InternalAxiosRequestConfig,
): Promise<InternalAxiosRequestConfig> => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.access_token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }
  return config;
};

type RetriableRequestConfig = InternalAxiosRequestConfig & { _retry?: boolean };

const retryOn401 = (instance: ReturnType<typeof axios.create>) =>
  async (error: AxiosError) => {
    const status = error.response?.status;
    const original = error.config as RetriableRequestConfig | undefined;
    if (status !== 401 || !original || original._retry) {
      return Promise.reject(error);
    }
    original._retry = true;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return Promise.reject(error);
    original.headers = original.headers || {};
    original.headers.Authorization = `Bearer ${session.access_token}`;
    return instance.request(original);
  };

// ── V2 API client (new backend on port 8001) ─────────────────────────────────

/** Main API client — routes: /ai/quiz, /ai/mains, /payments, /pdfs, /live, /analytics */
export const premiumApi = axios.create({
  baseURL: backendRoot,   // e.g. http://localhost:8001
});

premiumApi.interceptors.request.use(addAuthToken);
premiumApi.interceptors.response.use(
  (res) => res,
  retryOn401(premiumApi),
);

/** Admin API client — same base, just a semantic alias */
export const adminApi = premiumApi;

/**
 * Legacy compat alias — old code that imported premiumCompatApi still works.
 * Both point to same backend now since V2 has no /api/v1/premium-collections split.
 */
export const premiumCompatApi = premiumApi;

export const premiumApiRoot = backendRoot;
