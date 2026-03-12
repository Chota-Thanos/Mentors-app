import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { createClient } from "./supabase/client";

const API_ROOT = (process.env.NEXT_PUBLIC_SUPA_BACKEND_URL || "http://localhost:8003").replace(/\/$/, "");
const supabase = createClient();

export const premiumApi = axios.create({
  baseURL: `${API_ROOT}/api/v1/premium`,
});

export const premiumCompatApi = axios.create({
  baseURL: `${API_ROOT}/api/v1/premium-collections`,
});

// Add Interceptor for Authentication
const addAuthToken = async (config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> => {
  const { data: { session } } = await supabase.auth.getSession();

  if (session?.access_token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }
  return config;
};

premiumApi.interceptors.request.use(addAuthToken);
premiumCompatApi.interceptors.request.use(addAuthToken);

type RetriableRequestConfig = InternalAxiosRequestConfig & { _retry?: boolean };

const retryOn401 = async (error: AxiosError) => {
  const status = error.response?.status;
  const originalRequest = error.config as RetriableRequestConfig | undefined;
  if (status !== 401 || !originalRequest || originalRequest._retry) {
    return Promise.reject(error);
  }

  originalRequest._retry = true;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return Promise.reject(error);

  originalRequest.headers = originalRequest.headers || {};
  originalRequest.headers.Authorization = `Bearer ${session.access_token}`;
  return premiumApi.request(originalRequest);
};

premiumApi.interceptors.response.use((response) => response, retryOn401);
premiumCompatApi.interceptors.response.use((response) => response, retryOn401);

export const premiumApiRoot = API_ROOT;
