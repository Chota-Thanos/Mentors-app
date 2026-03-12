"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import AdminOnly from "@/components/auth/AdminOnly";
import AppLayout from "@/components/layouts/AppLayout";
import { legacyPremiumAiApi } from "@/lib/legacyPremiumAiApi";
import type { ConvertDraftToPremiumQuizResponse, PremiumAIDraftQuiz } from "@/types/premium";

type DraftKind = "gk" | "maths" | "passage";

function toKind(raw: string | null): DraftKind {
  if (raw === "maths") return "maths";
  if (raw === "passage") return "passage";
  return "gk";
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const maybe = error as { response?: { data?: { detail?: unknown } }; message?: unknown };
    if (typeof maybe.response?.data?.detail === "string") return maybe.response.data.detail;
    if (typeof maybe.message === "string") return maybe.message;
  }
  return "Unknown error";
}

export default function PremiumAIDraftEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const draftId = Number(params.id);
  const draftKind = useMemo(() => toKind(searchParams.get("quiz_kind")), [searchParams]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);

  const [draft, setDraft] = useState<PremiumAIDraftQuiz | null>(null);
  const [parsedJson, setParsedJson] = useState("{}");
  const [categoryIdsCsv, setCategoryIdsCsv] = useState("");
  const [examId, setExamId] = useState("");
  const [notes, setNotes] = useState("");

  const endpointBase = `/premium-ai-quizzes/draft-${draftKind}-quizzes/${draftId}`;

  useEffect(() => {
    const load = async () => {
      if (!Number.isFinite(draftId) || draftId <= 0) return;
      setLoading(true);
      try {
        const response = await legacyPremiumAiApi.get<PremiumAIDraftQuiz>(endpointBase);
        const item = response.data;
        setDraft(item);
        setParsedJson(JSON.stringify(item.parsed_quiz_data || {}, null, 2));
        setCategoryIdsCsv((item.category_ids || []).join(", "));
        setExamId(item.exam_id ? String(item.exam_id) : "");
        setNotes(item.notes || "");
      } catch (error: unknown) {
        toast.error("Failed to load draft", { description: errorMessage(error) });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [draftId, endpointBase]);

  const parseCategoryIds = (value: string): number[] =>
    value
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((id) => Number.isFinite(id) && id > 0);

  const save = async () => {
    if (!draft) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = parsedJson.trim() ? JSON.parse(parsedJson) : {};
    } catch {
      toast.error("Invalid JSON in parsed_quiz_data");
      return;
    }

    setSaving(true);
    try {
      const examIdParsed = Number(examId);
      const payload = {
        parsed_quiz_data: parsed,
        category_ids: parseCategoryIds(categoryIdsCsv),
        exam_id: Number.isFinite(examIdParsed) && examIdParsed > 0 ? examIdParsed : null,
        notes: notes.trim() || null,
      };
      const response = await legacyPremiumAiApi.put<PremiumAIDraftQuiz>(endpointBase, payload);
      setDraft(response.data);
      toast.success("Draft updated.");
    } catch (error: unknown) {
      toast.error("Failed to update draft", { description: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const convert = async () => {
    if (!draft) return;
    setConverting(true);
    try {
      const response = await legacyPremiumAiApi.post<ConvertDraftToPremiumQuizResponse>(
        "/premium-ai-quizzes/convert-draft-to-premium-quiz",
        { draft_quiz_id: draft.id },
      );
      toast.success(response.data.message || "Converted");
      router.push(`/content/${response.data.new_quiz_id}`);
    } catch (error: unknown) {
      toast.error("Failed to convert draft", { description: errorMessage(error) });
    } finally {
      setConverting(false);
    }
  };

  return (
    <AdminOnly>
      <AppLayout adminNav>
        <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Edit Premium AI Draft</h1>
            <p className="mt-1 text-sm text-slate-600">
              Draft #{draft?.id || draftId} ({draftKind.toUpperCase()})
            </p>
          </div>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            onClick={() => router.push("/admin/premium/ai-drafts")}
          >
            Back to Drafts
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 rounded border border-slate-200 bg-white p-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading draft...
          </div>
        ) : !draft ? (
          <div className="rounded border border-slate-200 bg-white p-6 text-sm text-slate-500">Draft not found.</div>
        ) : (
          <div className="space-y-4 rounded border border-slate-200 bg-white p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <input
                className="rounded border border-slate-300 px-3 py-2 text-sm"
                value={examId}
                onChange={(e) => setExamId(e.target.value)}
                placeholder="exam_id (optional)"
              />
              <input
                className="rounded border border-slate-300 px-3 py-2 text-sm"
                value={categoryIdsCsv}
                onChange={(e) => setCategoryIdsCsv(e.target.value)}
                placeholder="category_ids CSV"
              />
            </div>
            <textarea
              className="min-h-[70px] w-full rounded border border-slate-300 px-3 py-2 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="notes"
            />
            <textarea
              className="min-h-[360px] w-full rounded border border-slate-300 px-3 py-2 font-mono text-xs"
              value={parsedJson}
              onChange={(e) => setParsedJson(e.target.value)}
              placeholder="parsed_quiz_data JSON"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                onClick={save}
                disabled={saving || converting}
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
              <button
                type="button"
                className="rounded bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                onClick={convert}
                disabled={saving || converting}
              >
                {converting ? "Converting..." : "Convert to Premium Quiz"}
              </button>
            </div>
          </div>
        )}
        </div>
      </AppLayout>
    </AdminOnly>
  );
}
