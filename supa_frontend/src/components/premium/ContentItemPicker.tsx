"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";

import { premiumApi } from "@/lib/premiumApi";
import type { PremiumContentItem, QuizKind } from "@/types/premium";

interface ContentItemPickerProps {
  value: string;
  onChange: (value: string) => void;
  quizKind?: QuizKind;
  label?: string;
}

function previewText(item: PremiumContentItem): string {
  if (typeof item.title === "string" && item.title.trim()) {
    return item.title.trim();
  }

  const data = item.data;
  if (!data || typeof data !== "object") {
    return "No preview text available";
  }

  const candidates: unknown[] = [
    data.question_statement,
    data.question_prompt,
    data.question_text,
    data.passage_title,
    data.passage_text,
    data.source_reference,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  if (Array.isArray(data.questions) && data.questions.length > 0) {
    const first = data.questions[0];
    if (typeof first === "string" && first.trim()) {
      return first.trim();
    }
    if (first && typeof first === "object") {
      const nested = first as Record<string, unknown>;
      const nestedText = [nested.question_statement, nested.question_prompt, nested.question_text]
        .find((entry) => typeof entry === "string" && (entry as string).trim()) as string | undefined;
      if (nestedText && nestedText.trim()) {
        return nestedText.trim();
      }
    }
  }

  return "No preview text available";
}

function toErrorMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return "Unknown error";
  }
  if (typeof error.response?.data?.detail === "string") {
    return error.response.data.detail;
  }
  return error.message;
}

export default function ContentItemPicker({
  value,
  onChange,
  quizKind,
  label = "Search content items",
}: ContentItemPickerProps) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PremiumContentItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  const selectedId = Number(value);
  const selectedItem = useMemo(
    () => (Number.isFinite(selectedId) ? items.find((item) => item.id === selectedId) || null : null),
    [items, selectedId],
  );

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const run = async () => {
        setIsLoading(true);
        setErrorMessage("");
        try {
          const response = await premiumApi.get<PremiumContentItem[]>("/content", {
            params: {
              limit: 40,
              quiz_kind: quizKind,
              search: query.trim() || undefined,
            },
          });
          if (cancelled) {
            return;
          }
          setItems(Array.isArray(response.data) ? response.data : []);
        } catch (error: unknown) {
          if (cancelled) {
            return;
          }
          setItems([]);
          setErrorMessage(toErrorMessage(error));
        } finally {
          if (!cancelled) {
            setIsLoading(false);
          }
        }
      };
      void run();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, quizKind, refreshTick]);

  return (
    <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-2">
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          placeholder={quizKind ? `Search ${quizKind} content by id, title, question text...` : "Search by id, title, question text..."}
        />
        <button
          type="button"
          onClick={() => setRefreshTick((current) => current + 1)}
          className="rounded border border-slate-300 px-3 py-2 text-xs text-slate-700"
        >
          Search
        </button>
      </div>

      {selectedItem ? (
        <p className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
          Selected: #{selectedItem.id} | {selectedItem.type} | {previewText(selectedItem).slice(0, 90)}
        </p>
      ) : value ? (
        <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
          Selected ID: {value} (not in current search results)
        </p>
      ) : null}

      {errorMessage ? (
        <p className="rounded bg-rose-50 px-2 py-1 text-xs text-rose-700">{errorMessage}</p>
      ) : null}

      <div className="max-h-48 overflow-y-auto rounded border border-slate-200 bg-white">
        {isLoading ? (
          <p className="px-3 py-2 text-sm text-slate-500">Loading content...</p>
        ) : items.length === 0 ? (
          <p className="px-3 py-2 text-sm text-slate-500">No content items found.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onChange(String(item.id))}
                className="block w-full px-3 py-2 text-left hover:bg-slate-50"
              >
                <p className="text-xs text-slate-600">
                  #{item.id} | {item.type}
                </p>
                <p className="text-sm text-slate-800">{previewText(item).slice(0, 140)}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
