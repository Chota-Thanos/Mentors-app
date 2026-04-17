/**
 * API client for the new FastAPI backend (New_Supa_backend).
 * Automatically injects the Supabase session JWT as Bearer token.
 */

import { createClient } from '@/lib/supabase/client';

// ── Base URL ─────────────────────────────────────────────────────────────────

function getBackendUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured && configured !== 'auto') return configured.replace(/\/$/, '');

  if (typeof window !== 'undefined') {
    const port = process.env.NEXT_PUBLIC_SUPA_BACKEND_PORT || '8001';
    return `${window.location.protocol}//${window.location.hostname}:${port}`;
  }
  return 'http://localhost:8001';
}

export const API_BASE = getBackendUrl();

// ── JWT helper ────────────────────────────────────────────────────────────────

async function getToken(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

// ── Core fetch wrapper ────────────────────────────────────────────────────────

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
};

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let url = `${API_BASE}${path}`;
  if (opts.params) {
    const qs = new URLSearchParams(
      Object.entries(opts.params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    let detail: unknown;
    try { detail = await res.json(); } catch { detail = await res.text(); }
    throw new ApiError(
      res.status,
      `API Error ${res.status}: ${path}`,
      detail,
    );
  }

  return res.json() as Promise<T>;
}

// ── AI Quiz ───────────────────────────────────────────────────────────────────

export const aiQuizApi = {
  generate: (body: {
    domain: 'gk' | 'maths' | 'passage';
    source_type: 'text' | 'url' | 'pdf' | 'category';
    source_text?: string;
    source_url?: string;
    source_pdf_id?: number;
    category_ids?: number[];
    count?: number;
    language?: string;
    user_instructions?: string;
    recent_questions?: string[];
    format_id?: number;
    provider?: string;
    model?: string;
  }) => request<{ questions: unknown[]; quota: unknown; count: number }>('/ai/quiz/generate', {
    method: 'POST',
    body,
  }),

  save: (body: {
    title: string;
    domain: string;
    questions: unknown[];
    is_public?: boolean;
    source_type?: string;
    source_text?: string;
    category_ids?: number[];
  }) => request<{ id: number; title: string; question_count: number }>('/ai/quiz/save', {
    method: 'POST',
    body,
  }),

  getQuota: () => request<{
    plan: string;
    period: string;
    domains: Record<string, { used: number; limit: number; remaining: number }>;
  }>('/ai/quiz/quota'),
};

// ── AI Mains ──────────────────────────────────────────────────────────────────

export const aiMainsApi = {
  generateQuestion: (body: {
    source_text: string;
    category_id?: number;
    word_limit?: number;
    language?: string;
    save?: boolean;
    provider?: string;
    model?: string;
  }) => request<{ question_text: string; answer_approach: string; model_answer: string; word_limit: number; saved_id?: number; quota: unknown }>('/ai/mains/generate-question', {
    method: 'POST',
    body,
  }),

  evaluate: (body: {
    question_text: string;
    answer_text: string;
    word_limit?: number;
    model_answer?: string;
    save?: boolean;
    question_id?: number;
    provider?: string;
    model?: string;
  }) => request<{
    ai_score: number;
    ai_max_score: number;
    ai_feedback: string;
    ai_strengths: string[];
    ai_weaknesses: string[];
    ai_structure_score: number;
    ai_content_score: number;
    improved_answer: string;
    saved_id?: number;
  }>('/ai/mains/evaluate', { method: 'POST', body }),

  evaluateSubmission: (body: {
    submission_id: number;
    provider?: string;
    model?: string;
  }) => request<{ message: string; submission_id: number }>('/ai/mains/evaluate-submission', {
    method: 'POST',
    body,
  }),
};

// ── AI Articles ───────────────────────────────────────────────────────────────

export const aiArticlesApi = {
  generate: (body: {
    source_url?: string;
    source_text?: string;
    style_guide?: string;
    provider?: string;
    model?: string;
  }) => request<{ draft_id: number; title: string; excerpt: string; content: string }>('/ai/articles/generate', {
    method: 'POST',
    body,
  }),

  approve: (body: {
    draft_id: number;
    title?: string;
    content?: string;
    subject_id?: number;
    topic_id?: number;
    tags?: string[];
  }) => request<{ article_id: number; slug: string }>('/ai/articles/approve', {
    method: 'POST',
    body,
  }),

  getDrafts: (status = 'pending_review') =>
    request<{ drafts: unknown[] }>('/ai/articles/drafts', { params: { status } }),
};

// ── PDFs ──────────────────────────────────────────────────────────────────────

export const pdfsApi = {
  upload: async (file: File) => {
    const token = await getToken();
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${API_BASE}/pdfs/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (!res.ok) throw new ApiError(res.status, 'PDF upload failed');
    return res.json();
  },

  getMeta: (id: number) => request<unknown>(`/pdfs/${id}`),

  delete: (id: number) => request<{ message: string }>(`/pdfs/${id}`, { method: 'DELETE' }),

  extractUrl: (url: string) =>
    request<{ url: string; text: string; length: number }>('/pdfs/extract-url', {
      method: 'POST',
      body: { url },
    }),
};

// ── Payments ──────────────────────────────────────────────────────────────────

export const paymentsApi = {
  createOrder: (body: {
    item_type: 'test_series' | 'premium_collection' | 'subscription_plan';
    item_id: number | string;
  }) => request<{
    order_id: string;
    amount: number;
    currency: string;
    payment_record_id: number;
    key_id: string;
  }>('/payments/create-order', { method: 'POST', body }),

  verify: (body: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
    payment_record_id: number;
  }) => request<{ message: string; payment_id: number }>('/payments/verify', {
    method: 'POST',
    body,
  }),

  getHistory: () => request<{ payments: unknown[] }>('/payments/history'),
};

// ── Live Rooms ────────────────────────────────────────────────────────────────

export const liveApi = {
  getToken: (room_id: number, role: 'publisher' | 'subscriber' = 'subscriber') =>
    request<{
      token: string;
      channel: string;
      uid: number;
      app_id: string;
      role: string;
    }>('/live/token', { method: 'POST', body: { room_id, role } }),

  createRoom: (body: {
    series_id?: number;
    unit_step_id?: number;
    title: string;
    description?: string;
    scheduled_for?: string;
  }) => request<unknown>('/live/rooms', { method: 'POST', body }),

  updateStatus: (room_id: number, status: 'live' | 'ended' | 'cancelled') =>
    request<unknown>(`/live/rooms/${room_id}/status`, {
      method: 'PATCH',
      body: { status },
    }),

  getRoom: (room_id: number) => request<unknown>(`/live/rooms/${room_id}`),
};

// ── Analytics ─────────────────────────────────────────────────────────────────

export const analyticsApi = {
  rebuildSnapshot: (quiz_domain: string, category_id?: number) =>
    request<{ message: string; domain: string }>('/analytics/rebuild-snapshot', {
      method: 'POST',
      body: { quiz_domain, category_id },
    }),

  getMyAnalytics: () => request<{ snapshots: unknown[] }>('/analytics/me'),

  getWeakAreas: () => request<{ weak_areas: unknown[] }>('/analytics/weak-areas'),
};

// ── Health check ──────────────────────────────────────────────────────────────

export const healthApi = {
  check: () => request<{ status: string; version: string; environment: string }>('/health'),
};

export { ApiError };
