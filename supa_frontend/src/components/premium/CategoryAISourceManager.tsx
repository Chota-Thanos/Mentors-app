"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";

import { premiumApi, premiumApiRoot } from "@/lib/premiumApi";
import ContentItemPicker from "@/components/premium/ContentItemPicker";
import type { CategoryAISource, PremiumCategory, QuizKind } from "@/types/premium";

type FlatCategoryNode = {
  id: number;
  name: string;
  depth: number;
};

type SourceKind = "text" | "url" | "content_item";

const QUIZ_TYPES: QuizKind[] = ["gk", "maths", "passage"];
const SOURCE_KINDS: SourceKind[] = ["text", "url", "content_item"];

function flattenCategories(nodes: PremiumCategory[], depth = 0): FlatCategoryNode[] {
  const output: FlatCategoryNode[] = [];
  for (const node of nodes) {
    output.push({
      id: node.id,
      name: node.name,
      depth,
    });
    if (Array.isArray(node.children) && node.children.length > 0) {
      output.push(...flattenCategories(node.children, depth + 1));
    }
  }
  return output;
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

function parseMetaJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sourceKindHint(kind: SourceKind): string {
  if (kind === "text") {
    return "Use source_text or source_content_html.";
  }
  if (kind === "url") {
    return "Provide source_url. Optional fallback source_text can be added.";
  }
  return "Provide content_item_id. Optional source_text can be a fallback.";
}

export default function CategoryAISourceManager() {
  const [quizType, setQuizType] = useState<QuizKind>("gk");
  const [activeOnlySources, setActiveOnlySources] = useState(false);

  const [categories, setCategories] = useState<PremiumCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");

  const [sources, setSources] = useState<CategoryAISource[]>([]);

  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [isSavingSource, setIsSavingSource] = useState(false);
  const [isUploadingPdfSources, setIsUploadingPdfSources] = useState(false);
  const [deletingSourceId, setDeletingSourceId] = useState<number | null>(null);

  const [editingSourceId, setEditingSourceId] = useState<number | null>(null);
  const [sourceKind, setSourceKind] = useState<SourceKind>("text");
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [sourceContentHtml, setSourceContentHtml] = useState("");
  const [contentItemId, setContentItemId] = useState("");
  const [priority, setPriority] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [metaJson, setMetaJson] = useState("{}");
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [usePdfOcr, setUsePdfOcr] = useState(true);

  const quizTypeKey = `premium_${quizType}`;
  const flatCategories = useMemo(() => flattenCategories(categories), [categories]);
  const selectedCategory = useMemo(
    () => flatCategories.find((item) => String(item.id) === selectedCategoryId) || null,
    [flatCategories, selectedCategoryId],
  );

  const resetSourceForm = useCallback(() => {
    setEditingSourceId(null);
    setSourceKind("text");
    setTitle("");
    setSourceUrl("");
    setSourceText("");
    setSourceContentHtml("");
    setContentItemId("");
    setPriority("0");
    setIsActive(true);
    setMetaJson("{}");
    setPdfFiles([]);
    setUsePdfOcr(true);
  }, []);

  const loadCategories = useCallback(async () => {
    const response = await premiumApi.get<PremiumCategory[]>(
      `${premiumApiRoot}/api/v1/premium-categories/${quizTypeKey}/`,
      {
        params: {
          hierarchical: true,
        },
      },
    );
    setCategories(Array.isArray(response.data) ? response.data : []);
  }, [quizTypeKey]);

  const refreshContext = useCallback(async () => {
    setIsLoadingContext(true);
    try {
      await loadCategories();
    } catch (error: unknown) {
      toast.error("Failed to load category source context", { description: toErrorMessage(error) });
    } finally {
      setIsLoadingContext(false);
    }
  }, [loadCategories]);

  const loadSources = useCallback(async (categoryId: number) => {
    setIsLoadingSources(true);
    try {
      const response = await premiumApi.get<CategoryAISource[]>(`/categories/${categoryId}/ai-sources`, {
        params: { active_only: activeOnlySources },
      });
      setSources(Array.isArray(response.data) ? response.data : []);
    } catch (error: unknown) {
      toast.error("Failed to load category sources", { description: toErrorMessage(error) });
      setSources([]);
    } finally {
      setIsLoadingSources(false);
    }
  }, [activeOnlySources]);

  useEffect(() => {
    setIsLoadingContext(true);
    loadCategories()
      .catch((error: unknown) => {
        toast.error("Failed to load category source context", { description: toErrorMessage(error) });
      })
      .finally(() => setIsLoadingContext(false));
  }, [loadCategories]);

  useEffect(() => {
    if (flatCategories.length === 0) {
      setSelectedCategoryId("");
      setSources([]);
      resetSourceForm();
      return;
    }
    if (!selectedCategoryId || !flatCategories.some((item) => String(item.id) === selectedCategoryId)) {
      setSelectedCategoryId(String(flatCategories[0].id));
    }
  }, [flatCategories, resetSourceForm, selectedCategoryId]);

  useEffect(() => {
    const categoryId = Number(selectedCategoryId);
    if (!categoryId) {
      setSources([]);
      return;
    }
    loadSources(categoryId);
  }, [selectedCategoryId, loadSources]);

  const startEditSource = (item: CategoryAISource) => {
    setEditingSourceId(item.id);
    setSourceKind(item.source_kind);
    setTitle(item.title || "");
    setSourceUrl(item.source_url || "");
    setSourceText(item.source_text || "");
    setSourceContentHtml(item.source_content_html || "");
    setContentItemId(item.content_item_id ? String(item.content_item_id) : "");
    setPriority(String(item.priority ?? 0));
    setIsActive(Boolean(item.is_active));
    setMetaJson(JSON.stringify(item.meta || {}, null, 2));
    setPdfFiles([]);
  };

  const onPdfFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Array.from(event.target.files || []);
    if (next.length === 0) {
      return;
    }
    setPdfFiles((current) => [...current, ...next].slice(0, 20));
    event.target.value = "";
  };

  const removePendingPdf = (index: number) => {
    setPdfFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const saveSource = async (event: React.FormEvent) => {
    event.preventDefault();
    const categoryId = Number(selectedCategoryId);
    if (!categoryId) {
      toast.error("Select a category first");
      return;
    }

    const parsedMeta = parseMetaJson(metaJson);
    if (!parsedMeta) {
      toast.error("Meta must be a valid JSON object");
      return;
    }

    const numericPriority = Number(priority);
    if (!Number.isFinite(numericPriority)) {
      toast.error("Priority must be numeric");
      return;
    }

    const contentItemIdValue = contentItemId.trim();
    const parsedContentItemId = contentItemIdValue ? Number(contentItemIdValue) : null;
    if (contentItemIdValue && (!Number.isInteger(parsedContentItemId) || (parsedContentItemId || 0) <= 0)) {
      toast.error("content_item_id must be a positive integer");
      return;
    }

    const trimmedSourceText = sourceText.trim();
    const trimmedSourceHtml = sourceContentHtml.trim();
    const trimmedSourceUrl = sourceUrl.trim();

    if (sourceKind === "text" && !trimmedSourceText && !trimmedSourceHtml) {
      toast.error("Text source requires source_text or source_content_html");
      return;
    }
    if (sourceKind === "url" && !trimmedSourceUrl && !trimmedSourceText) {
      toast.error("URL source requires source_url");
      return;
    }
    if (sourceKind === "content_item" && !parsedContentItemId && !trimmedSourceText) {
      toast.error("Content-item source requires content_item_id");
      return;
    }

    const payload = {
      source_kind: sourceKind,
      title: title.trim() || null,
      source_url: trimmedSourceUrl || null,
      source_text: trimmedSourceText || null,
      source_content_html: trimmedSourceHtml || null,
      content_item_id: parsedContentItemId,
      priority: Math.trunc(numericPriority),
      is_active: isActive,
      meta: parsedMeta,
    };

    setIsSavingSource(true);
    try {
      if (editingSourceId) {
        await premiumApi.put(`/categories/${categoryId}/ai-sources/${editingSourceId}`, payload);
        toast.success(`Source #${editingSourceId} updated`);
      } else {
        await premiumApi.post(`/categories/${categoryId}/ai-sources`, payload);
        toast.success("Source created");
      }
      resetSourceForm();
      await loadSources(categoryId);
    } catch (error: unknown) {
      toast.error("Failed to save source", { description: toErrorMessage(error) });
    } finally {
      setIsSavingSource(false);
    }
  };

  const uploadPdfSources = async () => {
    const categoryId = Number(selectedCategoryId);
    if (!categoryId) {
      toast.error("Select a category first");
      return;
    }
    if (pdfFiles.length === 0) {
      toast.error("Select at least one PDF");
      return;
    }

    const numericPriority = Number(priority);
    if (!Number.isFinite(numericPriority)) {
      toast.error("Priority must be numeric");
      return;
    }

    const formData = new FormData();
    for (const file of pdfFiles) {
      formData.append("files", file);
    }

    setIsUploadingPdfSources(true);
    try {
      const response = await premiumApi.post<CategoryAISource[]>(
        `/categories/${categoryId}/ai-sources/upload-pdfs`,
        formData,
        {
          params: {
            use_ocr: usePdfOcr,
            priority: Math.trunc(numericPriority),
            is_active: isActive,
          },
        },
      );
      const createdCount = Array.isArray(response.data) ? response.data.length : 0;
      toast.success(createdCount > 0 ? `Added ${createdCount} PDF source(s)` : "PDF source upload completed");
      setPdfFiles([]);
      await loadSources(categoryId);
    } catch (error: unknown) {
      toast.error("Failed to upload PDF source(s)", { description: toErrorMessage(error) });
    } finally {
      setIsUploadingPdfSources(false);
    }
  };

  const deleteSource = async (item: CategoryAISource) => {
    const categoryId = Number(selectedCategoryId);
    if (!categoryId) {
      return;
    }
    const confirmed = window.confirm(`Delete source #${item.id}?`);
    if (!confirmed) {
      return;
    }
    setDeletingSourceId(item.id);
    try {
      await premiumApi.delete(`/categories/${categoryId}/ai-sources/${item.id}`);
      toast.success(`Source #${item.id} deleted`);
      if (editingSourceId === item.id) {
        resetSourceForm();
      }
      await loadSources(categoryId);
    } catch (error: unknown) {
      toast.error("Failed to delete source", { description: toErrorMessage(error) });
    } finally {
      setDeletingSourceId(null);
    }
  };

  return (
    <div className="space-y-5 rounded-md border border-slate-200 bg-white p-5">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Quiz Category AI Source Manager</h2>
        <p className="mt-1 text-sm text-slate-500">
          Attach and manage source-of-truth content for quiz categories and subcategories.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <select
          value={quizType}
          onChange={(event) => setQuizType(event.target.value as QuizKind)}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          {QUIZ_TYPES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <select
          value={selectedCategoryId}
          onChange={(event) => {
            setSelectedCategoryId(event.target.value);
            resetSourceForm();
          }}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          {flatCategories.length === 0 ? <option value="">No categories</option> : null}
          {flatCategories.map((item) => (
            <option key={item.id} value={String(item.id)}>
              {`${"  ".repeat(item.depth)}${item.depth > 0 ? "|- " : ""}${item.name} (ID ${item.id})`}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-3 rounded border border-slate-300 px-3 py-2 text-sm">
          <label className="inline-flex items-center gap-2 text-slate-700">
            <input
              type="checkbox"
              checked={activeOnlySources}
              onChange={(event) => setActiveOnlySources(event.target.checked)}
            />
            active only
          </label>
          <button
            type="button"
            onClick={refreshContext}
            className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        {isLoadingContext ? "Loading categories..." : null}
        {selectedCategory ? (
          <span>
            Selected category: <strong>ID {selectedCategory.id}</strong>
          </span>
        ) : (
          <span>Select a category to manage sources.</span>
        )}
      </div>

      <form onSubmit={saveSource} className="space-y-3 rounded border border-slate-200 p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Source kind</label>
            <select
              value={sourceKind}
              onChange={(event) => setSourceKind(event.target.value as SourceKind)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            >
              {SOURCE_KINDS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500">{sourceKindHint(sourceKind)}</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Title</label>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              placeholder="Optional label for this source"
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Priority</label>
            <input
              type="number"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">content_item_id</label>
            <input
              value={contentItemId}
              onChange={(event) => setContentItemId(event.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              placeholder="Optional for content_item kind"
            />
          </div>

          <div className="flex items-end pb-2">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
              />
              source active
            </label>
          </div>
        </div>

        <ContentItemPicker
          value={contentItemId}
          onChange={setContentItemId}
          quizKind={quizType}
          label="Search and select content_item_id"
        />

        <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              PDF source upload (single or multiple)
            </p>
            <label className="inline-flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={usePdfOcr}
                onChange={(event) => setUsePdfOcr(event.target.checked)}
              />
              OCR fallback
            </label>
          </div>
          <input
            type="file"
            accept="application/pdf"
            multiple
            onChange={onPdfFileSelect}
            className="block w-full text-xs text-slate-700 file:mr-3 file:rounded file:border file:border-slate-300 file:bg-white file:px-3 file:py-1 file:text-xs"
          />
          {pdfFiles.length > 0 ? (
            <div className="space-y-1 rounded border border-slate-200 bg-white p-2">
              {pdfFiles.map((file, index) => (
                <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-2 text-xs text-slate-700">
                  <span className="truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removePendingPdf(index)}
                    className="rounded border border-rose-200 px-2 py-0.5 text-rose-700"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={uploadPdfSources}
              disabled={isUploadingPdfSources || !selectedCategoryId || pdfFiles.length === 0}
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
            >
              {isUploadingPdfSources ? "Uploading..." : "Upload PDF source(s)"}
            </button>
            <span className="text-xs text-slate-500">
              PDF text is extracted once and stored in compact form for lower token usage during generation.
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">source_url</label>
          <input
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="https://..."
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">source_text</label>
            <textarea
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              className="min-h-[140px] w-full rounded border border-slate-300 px-3 py-2 text-sm"
              placeholder="Raw source text"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">source_content_html</label>
            <textarea
              value={sourceContentHtml}
              onChange={(event) => setSourceContentHtml(event.target.value)}
              className="min-h-[140px] w-full rounded border border-slate-300 px-3 py-2 text-sm"
              placeholder="Optional cleaned HTML content"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">meta (JSON object)</label>
          <textarea
            value={metaJson}
            onChange={(event) => setMetaJson(event.target.value)}
            className="min-h-[90px] w-full rounded border border-slate-300 px-3 py-2 font-mono text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={isSavingSource || !selectedCategoryId}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isSavingSource ? "Saving..." : editingSourceId ? `Update #${editingSourceId}` : "Create source"}
          </button>
          {editingSourceId ? (
            <button
              type="button"
              onClick={resetSourceForm}
              className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700"
            >
              Cancel edit
            </button>
          ) : null}
        </div>
      </form>

      <div className="space-y-2 rounded border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Attached sources</h3>
          <span className="text-xs text-slate-500">{sources.length} item(s)</span>
        </div>

        {isLoadingSources ? (
          <p className="text-sm text-slate-500">Loading sources...</p>
        ) : sources.length === 0 ? (
          <p className="text-sm text-slate-500">No sources attached yet.</p>
        ) : (
          <div className="space-y-2">
            {sources.map((item) => (
              <div key={item.id} className="rounded border border-slate-100 bg-slate-50 p-3">
                {(() => {
                  const meta = (item.meta && typeof item.meta === "object" ? item.meta : {}) as Record<string, unknown>;
                  const assetKind = String(meta.source_asset_kind || "");
                  const pdfFilename = typeof meta.filename === "string" ? meta.filename : null;
                  return (
                    <>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span className="rounded bg-slate-200 px-2 py-0.5 font-semibold text-slate-700">
                    #{item.id}
                  </span>
                  <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-700">{item.source_kind}</span>
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-700">priority {item.priority}</span>
                  <span className={`rounded px-2 py-0.5 ${item.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                    {item.is_active ? "active" : "inactive"}
                  </span>
                  {assetKind === "pdf" ? (
                    <span className="rounded bg-indigo-100 px-2 py-0.5 text-indigo-700">pdf</span>
                  ) : null}
                  {item.content_item_id ? (
                    <span className="rounded bg-purple-100 px-2 py-0.5 text-purple-700">
                      content_item_id {item.content_item_id}
                    </span>
                  ) : null}
                </div>
                {pdfFilename ? (
                  <p className="mt-1 text-xs text-slate-600">
                    PDF: <span className="font-mono">{pdfFilename}</span>
                  </p>
                ) : null}
                {item.title ? <p className="mt-2 text-sm font-medium text-slate-900">{item.title}</p> : null}
                {item.source_url ? (
                  <p className="mt-1 text-xs text-slate-600">
                    URL: <span className="font-mono">{item.source_url}</span>
                  </p>
                ) : null}
                {item.source_text ? (
                  <p className="mt-1 line-clamp-3 text-xs text-slate-600">
                    {item.source_text}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => startEditSource(item)}
                    disabled={deletingSourceId === item.id}
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteSource(item)}
                    disabled={deletingSourceId === item.id}
                    className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 disabled:opacity-60"
                  >
                    {deletingSourceId === item.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
