"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import AdminOnly from "@/components/auth/AdminOnly";
import AppLayout from "@/components/layouts/AppLayout";
import { legacyPremiumAiApi } from "@/lib/legacyPremiumAiApi";
import type {
  ConvertDraftToPremiumQuizResponse,
  PremiumAIDraftQuiz,
  PremiumAIDraftQuizListResponse,
  PremiumAIContentType,
} from "@/types/premium";

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const maybe = error as { response?: { data?: { detail?: unknown } }; message?: unknown };
    if (typeof maybe.response?.data?.detail === "string") return maybe.response.data.detail;
    if (typeof maybe.message === "string") return maybe.message;
  }
  return "Unknown error";
}

function contentTypeFromFilter(filter: string): PremiumAIContentType | null {
  if (filter === "gk") return "premium_gk_quiz";
  if (filter === "maths") return "premium_maths_quiz";
  if (filter === "passage") return "premium_passage_quiz";
  return null;
}

export default function PremiumAIDraftsPage() {
  return (
    <Suspense fallback={<PremiumAIDraftsLoading />}>
      <PremiumAIDraftsPageContent />
    </Suspense>
  );
}

function PremiumAIDraftsLoading() {
  return (
    <AdminOnly>
      <AppLayout adminNav>
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading drafts...
        </div>
      </AppLayout>
    </AdminOnly>
  );
}

function PremiumAIDraftsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filter = (searchParams.get("quiz_kind") || "all").toLowerCase();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PremiumAIDraftQuiz[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  const filterContentType = useMemo(() => contentTypeFromFilter(filter), [filter]);

  const loadDrafts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "300");
      if (filterContentType) params.set("content_type", filterContentType);
      const response = await legacyPremiumAiApi.get<PremiumAIDraftQuizListResponse>(
        `/premium-ai-quizzes/draft-quizzes?${params.toString()}`,
      );
      setItems(response.data.items || []);
    } catch (error: unknown) {
      toast.error("Failed to load drafts", { description: errorMessage(error) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterContentType]);

  const setFilter = (next: string) => {
    if (next === "all") router.push("/admin/premium/ai-drafts");
    else router.push(`/admin/premium/ai-drafts?quiz_kind=${encodeURIComponent(next)}`);
  };

  const deleteDraft = async (item: PremiumAIDraftQuiz) => {
    if (!window.confirm(`Delete draft #${item.id}?`)) return;
    setBusyId(item.id);
    try {
      await legacyPremiumAiApi.delete(`/premium-ai-quizzes/draft-${item.quiz_kind}-quizzes/${item.id}`);
      setItems((prev) => prev.filter((d) => d.id !== item.id));
      toast.success("Draft deleted.");
    } catch (error: unknown) {
      toast.error("Failed to delete draft", { description: errorMessage(error) });
    } finally {
      setBusyId(null);
    }
  };

  const convertDraft = async (item: PremiumAIDraftQuiz) => {
    setBusyId(item.id);
    try {
      const response = await legacyPremiumAiApi.post<ConvertDraftToPremiumQuizResponse>(
        "/premium-ai-quizzes/convert-draft-to-premium-quiz",
        { draft_quiz_id: item.id },
      );
      toast.success(response.data.message || "Converted");
      setItems((prev) => prev.filter((d) => d.id !== item.id));
      router.push(`/content/${response.data.new_quiz_id}`);
    } catch (error: unknown) {
      toast.error("Failed to convert draft", { description: errorMessage(error) });
    } finally {
      setBusyId(null);
    }
  };

  const draftPreview = (item: PremiumAIDraftQuiz): string => {
    const data = item.parsed_quiz_data || {};
    if (item.quiz_kind === "passage") {
      return String(data.passage_title || data.passage_text || "").slice(0, 140);
    }
    return String(data.question_statement || "").slice(0, 140);
  };

  return (
    <AdminOnly>
      <AppLayout adminNav>
        <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Premium AI Drafts</h1>
            <p className="mt-1 text-sm text-slate-600">Review, edit, and convert AI-generated drafts to premium quizzes.</p>
          </div>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            onClick={() => router.push("/admin/premium-ai-studio")}
          >
            Back to AI Studio
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-4">
          {["all", "gk", "maths", "passage"].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`rounded-md px-3 py-2 text-sm font-semibold ${filter === tab ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-50"}`}
            >
              {tab.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white">
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading drafts...
            </div>
          ) : items.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No drafts found.</div>
          ) : (
            <div className="divide-y">
              {items.map((item) => (
                <div key={item.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">Draft #{item.id}</span>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] uppercase text-slate-700">{item.quiz_kind}</span>
                      <span className="text-xs text-slate-500">{new Date(item.created_at).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{draftPreview(item) || "No preview available"}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      categories: {(item.category_ids || []).join(", ") || "none"}{item.exam_id ? ` | exam: ${item.exam_id}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-100"
                      onClick={() => router.push(`/admin/premium/ai-drafts/${item.id}?quiz_kind=${item.quiz_kind}`)}
                      disabled={busyId === item.id}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="rounded border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-100"
                      onClick={() => convertDraft(item)}
                      disabled={busyId === item.id}
                    >
                      {busyId === item.id ? "Working..." : "Convert"}
                    </button>
                    <button
                      type="button"
                      className="rounded border border-red-300 bg-white px-3 py-2 text-xs text-red-700 hover:bg-red-50"
                      onClick={() => deleteDraft(item)}
                      disabled={busyId === item.id}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </div>
      </AppLayout>
    </AdminOnly>
  );
}
