"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import ContentItemPicker from "@/components/premium/ContentItemPicker";
import { useProfile } from "@/context/ProfileContext";
import { pdfsApi } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { MainsCategory, MainsCategorySource } from "@/types/premium";

type SourceKind = "text" | "url" | "content_item";

type FlatMainsCategoryNode = {
  id: number;
  name: string;
  depth: number;
  parent_id: number | null;
  is_active: boolean;
};

const SOURCE_KINDS: SourceKind[] = ["text", "url", "content_item"];

function flattenMainsCategories(nodes: MainsCategory[], depth = 0): FlatMainsCategoryNode[] {
  const output: FlatMainsCategoryNode[] = [];
  for (const node of nodes) {
    output.push({
      id: node.id,
      name: node.name,
      depth,
      parent_id: node.parent_id ?? null,
      is_active: Boolean(node.is_active),
    });
    if (Array.isArray(node.children) && node.children.length > 0) {
      output.push(...flattenMainsCategories(node.children, depth + 1));
    }
  }
  return output;
}

function collectDescendantIds(nodes: MainsCategory[], rootId: number): Set<number> {
  const output = new Set<number>();
  const walk = (items: MainsCategory[], include: boolean) => {
    for (const item of items) {
      const shouldInclude = include || item.id === rootId;
      if (shouldInclude) {
        output.add(item.id);
      }
      if (Array.isArray(item.children) && item.children.length > 0) {
        walk(item.children, shouldInclude);
      }
    }
  };
  walk(nodes, false);
  return output;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function buildMainsCategoryTree(rows: MainsCategory[]): MainsCategory[] {
  const byId = new Map<number, MainsCategory>();
  const roots: MainsCategory[] = [];
  for (const row of rows) byId.set(row.id, { ...row, children: [] });
  for (const row of byId.values()) {
    const parent = row.parent_id ? byId.get(row.parent_id) : null;
    if (parent) parent.children = [...(parent.children || []), row];
    else roots.push(row);
  }
  return roots;
}

function normalizeSource(row: any, categoryId: number): MainsCategorySource {
  return {
    ...row,
    mains_category_id: categoryId,
    category_id: categoryId,
    source_kind: row.source_kind === "pdf" ? "url" : row.source_kind,
    content_item_id: row.content_item_id ?? null,
    meta: row.meta || {},
  } as MainsCategorySource;
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

function findMainsCategoryById(nodes: MainsCategory[], id: number): MainsCategory | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const children = Array.isArray(node.children) ? node.children : [];
    const nested = findMainsCategoryById(children, id);
    if (nested) {
      return nested;
    }
  }
  return null;
}

export default function MainsCategorySourceManager() {
  const { profileId } = useProfile();
  const [categories, setCategories] = useState<MainsCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<number | null>(null);

  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [categoryParentId, setCategoryParentId] = useState<string>("");
  const [categoryIsActive, setCategoryIsActive] = useState(true);
  const [categoryMetaJson, setCategoryMetaJson] = useState("{}");

  const [activeOnlySources, setActiveOnlySources] = useState(false);
  const [sources, setSources] = useState<MainsCategorySource[]>([]);
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
  const [sourceMetaJson, setSourceMetaJson] = useState("{}");
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [usePdfOcr, setUsePdfOcr] = useState(true);

  const flatCategories = useMemo(() => flattenMainsCategories(categories), [categories]);
  const selectedCategory = useMemo(
    () => flatCategories.find((item) => String(item.id) === selectedCategoryId) || null,
    [flatCategories, selectedCategoryId],
  );
  const blockedParentIds = useMemo(
    () => (editingCategoryId ? collectDescendantIds(categories, editingCategoryId) : new Set<number>()),
    [categories, editingCategoryId],
  );
  const categoryParentOptions = useMemo(
    () => flatCategories.filter((item) => !blockedParentIds.has(item.id)),
    [blockedParentIds, flatCategories],
  );

  const resetCategoryForm = useCallback(() => {
    setEditingCategoryId(null);
    setCategoryName("");
    setCategorySlug("");
    setCategoryDescription("");
    setCategoryParentId("");
    setCategoryIsActive(true);
    setCategoryMetaJson("{}");
  }, []);

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
    setSourceMetaJson("{}");
    setPdfFiles([]);
    setUsePdfOcr(true);
  }, []);

  const loadCategories = useCallback(async () => {
    setIsLoadingCategories(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .eq("domain", "mains")
        .order("display_order", { ascending: true });
      if (error) throw error;
      setCategories(buildMainsCategoryTree((data || []) as unknown as MainsCategory[]));
    } catch (error: unknown) {
      toast.error("Failed to load mains categories", { description: toErrorMessage(error) });
      setCategories([]);
    } finally {
      setIsLoadingCategories(false);
    }
  }, []);

  const loadSources = useCallback(async (categoryId: number) => {
    setIsLoadingSources(true);
    try {
      const supabase = createClient();
      const { data: links, error: linkError } = await supabase
        .from("category_ai_source_categories")
        .select("source_id")
        .eq("category_id", categoryId);
      if (linkError) throw linkError;
      const sourceIds = (links || []).map((row: any) => Number(row.source_id)).filter(Boolean);
      if (sourceIds.length === 0) {
        setSources([]);
        return;
      }
      let query = supabase
        .from("category_ai_sources")
        .select("*")
        .in("id", sourceIds)
        .order("priority", { ascending: false });
      if (activeOnlySources) query = query.eq("is_active", true);
      const { data, error } = await query;
      if (error) throw error;
      setSources((data || []).map((row) => normalizeSource(row, categoryId)));
    } catch (error: unknown) {
      toast.error("Failed to load mains category sources", { description: toErrorMessage(error) });
      setSources([]);
    } finally {
      setIsLoadingSources(false);
    }
  }, [activeOnlySources]);

  useEffect(() => {
    loadCategories();
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
    if (!categoryParentId) {
      return;
    }
    const parentId = Number(categoryParentId);
    const parentExists = categoryParentOptions.some((item) => item.id === parentId);
    if (!parentExists) {
      setCategoryParentId("");
    }
  }, [categoryParentId, categoryParentOptions]);

  useEffect(() => {
    const categoryId = Number(selectedCategoryId);
    if (!categoryId) {
      setSources([]);
      return;
    }
    loadSources(categoryId);
  }, [selectedCategoryId, loadSources]);

  const startEditCategory = (item: FlatMainsCategoryNode) => {
    const found = findMainsCategoryById(categories, item.id);
    setEditingCategoryId(item.id);
    setCategoryName(item.name);
    setCategorySlug(found?.slug || "");
    setCategoryDescription(found?.description || "");
    setCategoryParentId(item.parent_id ? String(item.parent_id) : "");
    setCategoryIsActive(Boolean(found?.is_active ?? item.is_active));
    setCategoryMetaJson(JSON.stringify(found?.meta || {}, null, 2));
  };

  const saveCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!categoryName.trim()) {
      toast.error("Category name is required");
      return;
    }

    const parentIdValue = categoryParentId.trim();
    const parsedParentId = parentIdValue ? Number(parentIdValue) : null;
    if (parentIdValue && (!Number.isInteger(parsedParentId) || (parsedParentId || 0) <= 0)) {
      toast.error("parent_id must be a positive integer");
      return;
    }
    if (editingCategoryId && parsedParentId && blockedParentIds.has(parsedParentId)) {
      toast.error("Invalid parent: a category cannot be nested inside itself or its descendants");
      return;
    }

    const payload = {
      name: categoryName.trim(),
      slug: categorySlug.trim() || null,
      description: categoryDescription.trim() || null,
      parent_id: parsedParentId,
      is_active: categoryIsActive,
    };

    setIsSavingCategory(true);
    try {
      const supabase = createClient();
      if (editingCategoryId) {
        const { data, error } = await supabase.from("categories").update({
          ...payload,
          domain: "mains",
        }).eq("id", editingCategoryId).select().single();
        if (error) throw error;
        toast.success(`Mains category #${editingCategoryId} updated`);
        setSelectedCategoryId(String(data?.id || editingCategoryId));
      } else {
        const { data, error } = await supabase.from("categories").insert({
          ...payload,
          domain: "mains",
        }).select().single();
        if (error) throw error;
        const createdId = data?.id;
        toast.success(createdId ? `Mains category #${createdId} created` : "Mains category created");
        if (createdId) {
          setSelectedCategoryId(String(createdId));
        }
      }
      resetCategoryForm();
      await loadCategories();
    } catch (error: unknown) {
      toast.error("Failed to save mains category", { description: toErrorMessage(error) });
    } finally {
      setIsSavingCategory(false);
    }
  };

  const deleteCategory = async (item: FlatMainsCategoryNode) => {
    const confirmed = window.confirm(`Delete mains category "${item.name}" (ID ${item.id})?`);
    if (!confirmed) {
      return;
    }
    setDeletingCategoryId(item.id);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("categories").delete().eq("id", item.id);
      if (error) throw error;
      toast.success(`Mains category #${item.id} deleted`);
      if (editingCategoryId === item.id) {
        resetCategoryForm();
      }
      if (selectedCategoryId === String(item.id)) {
        setSelectedCategoryId("");
      }
      await loadCategories();
    } catch (error: unknown) {
      toast.error("Failed to delete mains category", { description: toErrorMessage(error) });
    } finally {
      setDeletingCategoryId(null);
    }
  };

  const startEditSource = (item: MainsCategorySource) => {
    setEditingSourceId(item.id);
    setSourceKind(item.source_kind === "url" ? "url" : item.content_item_id ? "content_item" : "text");
    setTitle(item.title || "");
    setSourceUrl(item.source_url || "");
    setSourceText(item.source_text || "");
    setSourceContentHtml(item.source_content_html || "");
    setContentItemId(item.content_item_id ? String(item.content_item_id) : "");
    setPriority(String(item.priority ?? 0));
    setIsActive(Boolean(item.is_active));
    setSourceMetaJson(JSON.stringify(item.meta || {}, null, 2));
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
      toast.error("Select a mains category first");
      return;
    }

    const parsedMeta = parseMetaJson(sourceMetaJson);
    if (!parsedMeta) {
      toast.error("Source meta must be a valid JSON object");
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
      if (!profileId) throw new Error("Profile is not loaded yet.");
      const supabase = createClient();
      const dbPayload = {
        source_kind: sourceKind === "content_item" ? "text" : sourceKind,
        title: payload.title,
        source_url: payload.source_url,
        source_text: sourceKind === "content_item"
          ? `Linked content item: ${parsedContentItemId}`
          : payload.source_text,
        source_content_html: payload.source_content_html,
        priority: payload.priority,
        is_active: payload.is_active,
        created_by: profileId,
      };
      if (editingSourceId) {
        const { error } = await supabase.from("category_ai_sources").update(dbPayload).eq("id", editingSourceId);
        if (error) throw error;
        await supabase.from("category_ai_source_categories").upsert({
          source_id: editingSourceId,
          category_id: categoryId,
        });
        toast.success(`Source #${editingSourceId} updated`);
      } else {
        const { data, error } = await supabase.from("category_ai_sources").insert(dbPayload).select("id").single();
        if (error) throw error;
        const { error: linkError } = await supabase.from("category_ai_source_categories").insert({
          source_id: data.id,
          category_id: categoryId,
        });
        if (linkError) throw linkError;
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
      toast.error("Select a mains category first");
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

    setIsUploadingPdfSources(true);
    try {
      if (!profileId) throw new Error("Profile is not loaded yet.");
      const supabase = createClient();
      let createdCount = 0;
      for (const file of pdfFiles) {
        const uploaded = await pdfsApi.upload(file) as any;
        const { data, error } = await supabase.from("category_ai_sources").insert({
          source_kind: "pdf",
          title: file.name,
          source_pdf_id: uploaded.id ?? uploaded.pdf_id ?? null,
          priority: Math.trunc(numericPriority),
          is_active: isActive,
          created_by: profileId,
        }).select("id").single();
        if (error) throw error;
        const { error: linkError } = await supabase.from("category_ai_source_categories").insert({
          source_id: data.id,
          category_id: categoryId,
        });
        if (linkError) throw linkError;
        createdCount += 1;
      }
      toast.success(createdCount > 0 ? `Added ${createdCount} PDF source(s)` : "PDF source upload completed");
      setPdfFiles([]);
      await loadSources(categoryId);
    } catch (error: unknown) {
      toast.error("Failed to upload PDF source(s)", { description: toErrorMessage(error) });
    } finally {
      setIsUploadingPdfSources(false);
    }
  };

  const deleteSource = async (item: MainsCategorySource) => {
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
      const supabase = createClient();
      await supabase.from("category_ai_source_categories").delete().eq("source_id", item.id).eq("category_id", categoryId);
      const { error } = await supabase.from("category_ai_sources").delete().eq("id", item.id);
      if (error) throw error;
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
        <h2 className="text-lg font-bold text-slate-900">Mains Taxonomy and Source Manager</h2>
        <p className="mt-1 text-sm text-slate-500">
          Manage separate mains categories and attach source-of-truth documents for AI generation.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={saveCategory} className="space-y-3 rounded border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">
            {editingCategoryId ? `Edit Mains Category #${editingCategoryId}` : "Create Mains Category"}
          </h3>
          <input
            value={categoryName}
            onChange={(event) => setCategoryName(event.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="Category name"
          />
          <input
            value={categorySlug}
            onChange={(event) => setCategorySlug(event.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="Slug (optional)"
          />
          <input
            value={categoryDescription}
            onChange={(event) => setCategoryDescription(event.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="Description"
          />
          <select
            value={categoryParentId}
            onChange={(event) => setCategoryParentId(event.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Root (no parent)</option>
            {categoryParentOptions.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {`${"  ".repeat(item.depth)}${item.depth > 0 ? "|- " : ""}${item.name} (ID ${item.id})`}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={categoryIsActive}
              onChange={(event) => setCategoryIsActive(event.target.checked)}
            />
            category active
          </label>
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">meta (JSON object)</label>
            <textarea
              value={categoryMetaJson}
              onChange={(event) => setCategoryMetaJson(event.target.value)}
              className="min-h-[90px] w-full rounded border border-slate-300 px-3 py-2 font-mono text-xs"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isSavingCategory}
              className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {isSavingCategory ? "Saving..." : editingCategoryId ? "Update category" : "Create category"}
            </button>
            {editingCategoryId ? (
              <button
                type="button"
                onClick={resetCategoryForm}
                className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700"
              >
                Cancel edit
              </button>
            ) : null}
            <button
              type="button"
              onClick={loadCategories}
              className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700"
            >
              Refresh categories
            </button>
          </div>
        </form>

        <div className="space-y-2 rounded border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Current mains categories</h3>
          {isLoadingCategories ? (
            <p className="text-sm text-slate-500">Loading mains categories...</p>
          ) : flatCategories.length === 0 ? (
            <p className="text-sm text-slate-500">No mains categories created yet.</p>
          ) : (
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {flatCategories.map((item) => (
                <div key={item.id} className="rounded border border-slate-100 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span className="rounded bg-slate-200 px-2 py-0.5 font-semibold text-slate-700">
                      #{item.id}
                    </span>
                    <span className={`rounded px-2 py-0.5 ${item.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                      {item.is_active ? "active" : "inactive"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-900" style={{ paddingLeft: `${item.depth * 14}px` }}>
                    {item.depth > 0 ? "|- " : ""}
                    {item.name}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedCategoryId(String(item.id))}
                      className="rounded border border-blue-200 px-2 py-1 text-xs text-blue-700"
                    >
                      Manage sources
                    </button>
                    <button
                      type="button"
                      onClick={() => startEditCategory(item)}
                      disabled={deletingCategoryId === item.id}
                      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteCategory(item)}
                      disabled={deletingCategoryId === item.id}
                      className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 disabled:opacity-60"
                    >
                      {deletingCategoryId === item.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        {selectedCategory ? (
          <span>
            Source target: <strong>{selectedCategory.name}</strong> (ID {selectedCategory.id})
          </span>
        ) : (
          <span>Select a mains category to manage sources.</span>
        )}
      </div>

      <form onSubmit={saveSource} className="space-y-3 rounded border border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900">
            {editingSourceId ? `Edit Source #${editingSourceId}` : "Add Mains Source"}
          </h3>
          <label className="inline-flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={activeOnlySources}
              onChange={(event) => setActiveOnlySources(event.target.checked)}
            />
            show active only
          </label>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Source target category</label>
          <select
            value={selectedCategoryId}
            onChange={(event) => {
              setSelectedCategoryId(event.target.value);
              resetSourceForm();
            }}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {flatCategories.length === 0 ? <option value="">No mains categories</option> : null}
            {flatCategories.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {`${"  ".repeat(item.depth)}${item.depth > 0 ? "|- " : ""}${item.name} (ID ${item.id})`}
              </option>
            ))}
          </select>
        </div>

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
            value={sourceMetaJson}
            onChange={(event) => setSourceMetaJson(event.target.value)}
            className="min-h-[90px] w-full rounded border border-slate-300 px-3 py-2 font-mono text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={isSavingSource || !selectedCategoryId}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isSavingSource ? "Saving..." : editingSourceId ? `Update #${editingSourceId}` : "Add source"}
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
          <h3 className="text-sm font-semibold text-slate-900">Attached mains sources</h3>
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
