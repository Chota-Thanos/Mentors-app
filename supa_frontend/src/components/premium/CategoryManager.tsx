"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import axios from "axios";

import { premiumApi, premiumApiRoot } from "@/lib/premiumApi";
import type { PremiumCategory, PremiumExam, QuizKind } from "@/types/premium";

const QUIZ_TYPES: QuizKind[] = ["gk", "maths", "passage"];

type FlatCategoryNode = {
  id: number;
  name: string;
  description: string | null;
  depth: number;
  parent_id: number | null;
  exam_ids: number[];
};

type BulkCategoryInput = {
  name: string;
  description?: string;
};

type ActionFeedbackTone = "info" | "success" | "error";

type ActionFeedback = {
  tone: ActionFeedbackTone;
  message: string;
  at: string;
};

function flatten(nodes: PremiumCategory[], depth = 0): FlatCategoryNode[] {
  const output: FlatCategoryNode[] = [];
  for (const node of nodes) {
    output.push({
      id: node.id,
      name: node.name,
      description: typeof node.description === "string" ? node.description : null,
      depth,
      parent_id: node.parent_id ?? null,
      exam_ids: Array.isArray(node.exam_ids) ? node.exam_ids : [],
    });
    if (Array.isArray(node.children) && node.children.length > 0) {
      output.push(...flatten(node.children, depth + 1));
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

function parseBulkCategoryInput(raw: string): BulkCategoryInput[] {
  const output: BulkCategoryInput[] = [];
  for (const line of raw.split("\n")) {
    const cleaned = line.trim();
    if (!cleaned) {
      continue;
    }
    const parts = cleaned.split("|");
    const name = (parts[0] || "").trim();
    const description = parts.length > 1 ? parts.slice(1).join("|").trim() : "";
    if (!name) {
      continue;
    }
    const item: BulkCategoryInput = { name };
    if (description) {
      item.description = description;
    }
    output.push(item);
  }
  return output;
}

function findPathToCategory(nodes: PremiumCategory[], targetId: number): number[] {
  for (const node of nodes) {
    if (node.id === targetId) {
      return [node.id];
    }
    const children = Array.isArray(node.children) ? node.children : [];
    const nestedPath = findPathToCategory(children, targetId);
    if (nestedPath.length > 0) {
      return [node.id, ...nestedPath];
    }
  }
  return [];
}

function trimPathToExisting(nodes: PremiumCategory[], rawPath: number[]): number[] {
  const output: number[] = [];
  let currentLevel = nodes;
  for (const id of rawPath) {
    const found = currentLevel.find((node) => node.id === id);
    if (!found) {
      break;
    }
    output.push(id);
    currentLevel = Array.isArray(found.children) ? found.children : [];
  }
  return output;
}

function buildPathLevels(nodes: PremiumCategory[], selectedPath: number[], blockedId: number | null = null): PremiumCategory[][] {
  const levels: PremiumCategory[][] = [];
  let currentLevel = blockedId ? nodes.filter((node) => node.id !== blockedId) : nodes;
  levels.push(currentLevel);

  for (let index = 0; index < selectedPath.length; index += 1) {
    const selectedId = selectedPath[index];
    const selectedNode = currentLevel.find((node) => node.id === selectedId);
    if (!selectedNode) {
      break;
    }
    const children = Array.isArray(selectedNode.children) ? selectedNode.children : [];
    if (children.length === 0) {
      break;
    }
    currentLevel = blockedId ? children.filter((node) => node.id !== blockedId) : children;
    levels.push(currentLevel);
  }
  return levels;
}

export default function CategoryManager() {
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingExam, setIsSavingExam] = useState(false);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [isSavingBulkCategory, setIsSavingBulkCategory] = useState(false);
  const [deletingExamId, setDeletingExamId] = useState<number | null>(null);
  const [deletingCategoryId, setDeletingCategoryId] = useState<number | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);

  const [quizType, setQuizType] = useState<QuizKind>("gk");
  const [examFilterId, setExamFilterId] = useState<string>("");

  const [exams, setExams] = useState<PremiumExam[]>([]);
  const [categoryTree, setCategoryTree] = useState<PremiumCategory[]>([]);

  const [examName, setExamName] = useState("");
  const [examSlug, setExamSlug] = useState("");
  const [examDescription, setExamDescription] = useState("");
  const [examActive, setExamActive] = useState(true);
  const [editingExamId, setEditingExamId] = useState<number | null>(null);
  const [editExamName, setEditExamName] = useState("");
  const [editExamSlug, setEditExamSlug] = useState("");
  const [editExamDescription, setEditExamDescription] = useState("");
  const [editExamActive, setEditExamActive] = useState(true);
  const [isUpdatingExam, setIsUpdatingExam] = useState(false);

  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [parentPathIds, setParentPathIds] = useState<number[]>([]);
  const [categoryExamIds, setCategoryExamIds] = useState<number[]>([]);
  const [bulkParentPathIds, setBulkParentPathIds] = useState<number[]>([]);
  const [bulkExamIds, setBulkExamIds] = useState<number[]>([]);
  const [bulkCategoryInput, setBulkCategoryInput] = useState("");

  const flatCategories = useMemo(() => flatten(categoryTree), [categoryTree]);
  const quizTypeKey = `premium_${quizType}`;
  const selectedParentId = parentPathIds.length > 0 ? parentPathIds[parentPathIds.length - 1] : null;
  const selectedBulkParentId = bulkParentPathIds.length > 0 ? bulkParentPathIds[bulkParentPathIds.length - 1] : null;

  const createParentLevels = useMemo(
    () => buildPathLevels(categoryTree, parentPathIds, editingCategoryId),
    [categoryTree, parentPathIds, editingCategoryId],
  );
  const bulkParentLevels = useMemo(
    () => buildPathLevels(categoryTree, bulkParentPathIds),
    [categoryTree, bulkParentPathIds],
  );

  const setFeedback = useCallback((tone: ActionFeedbackTone, message: string) => {
    setActionFeedback({
      tone,
      message,
      at: new Date().toLocaleTimeString(),
    });
  }, []);

  const resetCategoryForm = useCallback(() => {
    setEditingCategoryId(null);
    setCategoryName("");
    setCategoryDescription("");
    setParentPathIds([]);
    setCategoryExamIds(examFilterId ? [Number(examFilterId)] : []);
  }, [examFilterId]);

  const resetBulkForm = useCallback(() => {
    setBulkParentPathIds([]);
    setBulkExamIds([]);
    setBulkCategoryInput("");
  }, []);

  const loadExams = useCallback(async () => {
    try {
      const response = await premiumApi.get<PremiumExam[]>("/exams");
      const data = response.data || [];
      setExams(data);
      if (data.length === 0) {
        setExamFilterId("");
        return;
      }
      const hasSelected = examFilterId ? data.some((exam) => String(exam.id) === examFilterId) : false;
      if (!examFilterId || !hasSelected) {
        setExamFilterId(String(data[0].id));
      }
    } catch (error: unknown) {
      toast.error("Failed to load exams", { description: toErrorMessage(error) });
      setFeedback("error", "Failed to load exams.");
    }
  }, [examFilterId, setFeedback]);

  const loadCategories = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await premiumApi.get<PremiumCategory[]>(
        `${premiumApiRoot}/api/v1/premium-categories/${quizTypeKey}/`,
        {
          params: {
            hierarchical: true,
            exam_id: examFilterId ? Number(examFilterId) : undefined,
          },
        },
      );
      setCategoryTree(response.data || []);
    } catch (error: unknown) {
      toast.error("Failed to load premium categories", { description: toErrorMessage(error) });
      setFeedback("error", "Failed to load categories.");
    } finally {
      setIsLoading(false);
    }
  }, [examFilterId, quizTypeKey, setFeedback]);

  useEffect(() => {
    loadExams();
  }, [loadExams]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    setParentPathIds((prev) => trimPathToExisting(categoryTree, prev));
  }, [categoryTree]);

  useEffect(() => {
    setBulkParentPathIds((prev) => trimPathToExisting(categoryTree, prev));
  }, [categoryTree]);

  useEffect(() => {
    if (editingCategoryId) {
      return;
    }
    if (!examFilterId) {
      setCategoryExamIds([]);
      return;
    }
    if (categoryExamIds.length === 0) {
      setCategoryExamIds([Number(examFilterId)]);
    }
  }, [examFilterId, editingCategoryId, categoryExamIds.length]);

  const createExam = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!examName.trim()) {
      toast.error("Exam name is required");
      return;
    }

    setIsSavingExam(true);
    setFeedback("info", "Creating exam...");
    try {
      await premiumApi.post("/exams", {
        name: examName,
        slug: examSlug || null,
        description: examDescription || null,
        is_active: examActive,
      });
      toast.success("Exam created");
      setFeedback("success", "Exam created successfully.");
      setExamName("");
      setExamSlug("");
      setExamDescription("");
      setExamActive(true);
      await loadExams();
    } catch (error: unknown) {
      toast.error("Failed to create exam", { description: toErrorMessage(error) });
      setFeedback("error", "Exam creation failed.");
    } finally {
      setIsSavingExam(false);
    }
  };

  const startEditExam = (exam: PremiumExam) => {
    setEditingExamId(exam.id);
    setEditExamName(exam.name);
    setEditExamSlug(exam.slug || "");
    setEditExamDescription(exam.description || "");
    setEditExamActive(Boolean(exam.is_active));
    setFeedback("info", `Editing exam "${exam.name}" (ID ${exam.id}).`);
  };

  const cancelEditExam = (withFeedback = true) => {
    setEditingExamId(null);
    setEditExamName("");
    setEditExamSlug("");
    setEditExamDescription("");
    setEditExamActive(true);
    if (withFeedback) {
      setFeedback("info", "Exam editing cancelled.");
    }
  };

  const saveExamEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingExamId) {
      return;
    }
    if (!editExamName.trim()) {
      toast.error("Exam name is required");
      return;
    }

    setIsUpdatingExam(true);
    setFeedback("info", `Updating exam ID ${editingExamId}...`);
    try {
      await premiumApi.put(`/exams/${editingExamId}`, {
        name: editExamName,
        slug: editExamSlug || null,
        description: editExamDescription || null,
        is_active: editExamActive,
      });
      toast.success("Exam updated");
      setFeedback("success", `Exam ID ${editingExamId} updated.`);
      cancelEditExam(false);
      await loadExams();
      await loadCategories();
    } catch (error: unknown) {
      toast.error("Failed to update exam", { description: toErrorMessage(error) });
      setFeedback("error", `Exam ID ${editingExamId} update failed.`);
    } finally {
      setIsUpdatingExam(false);
    }
  };

  const removeExam = async (exam: PremiumExam) => {
    const confirmed = window.confirm(`Delete exam "${exam.name}" (ID ${exam.id})?`);
    if (!confirmed) {
      setFeedback("info", `Exam delete cancelled for ID ${exam.id}.`);
      return;
    }
    setDeletingExamId(exam.id);
    setFeedback("info", `Deleting exam "${exam.name}"...`);
    try {
      await premiumApi.delete(`/exams/${exam.id}`);
      toast.success("Exam deleted");
      setFeedback("success", `Exam "${exam.name}" deleted.`);
      if (editingExamId === exam.id) {
        cancelEditExam(false);
      }
      await loadExams();
      await loadCategories();
    } catch (error: unknown) {
      toast.error("Failed to delete exam", { description: toErrorMessage(error) });
      setFeedback("error", `Failed to delete exam "${exam.name}".`);
    } finally {
      setDeletingExamId(null);
    }
  };

  const toggleCategoryExam = (id: number) => {
    setCategoryExamIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const toggleBulkExam = (id: number) => {
    setBulkExamIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const setCreatePathAtLevel = (level: number, value: string) => {
    setParentPathIds((prev) => {
      const next = prev.slice(0, level);
      if (value) {
        next.push(Number(value));
      }
      return next;
    });
  };

  const setBulkPathAtLevel = (level: number, value: string) => {
    setBulkParentPathIds((prev) => {
      const next = prev.slice(0, level);
      if (value) {
        next.push(Number(value));
      }
      return next;
    });
  };

  const handleCreateExamFilterChange = (value: string) => {
    setExamFilterId(value);
    if (!editingCategoryId) {
      setCategoryExamIds(value ? [Number(value)] : []);
    }
    setFeedback("info", value ? `Exam context changed to ID ${value}.` : "Exam context set to all exams.");
  };

  const startEditCategory = (category: FlatCategoryNode) => {
    setEditingCategoryId(category.id);
    setCategoryName(category.name);
    setCategoryDescription(category.description || "");
    const parentPath = category.parent_id ? findPathToCategory(categoryTree, category.parent_id) : [];
    setParentPathIds(parentPath);
    if (category.exam_ids.length > 0) {
      setCategoryExamIds(category.exam_ids);
    } else if (examFilterId) {
      setCategoryExamIds([Number(examFilterId)]);
    } else {
      setCategoryExamIds([]);
    }
    setFeedback("info", `Editing category "${category.name}" (ID ${category.id}).`);
  };

  const saveCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    const effectiveCategoryExamIds = categoryExamIds.length > 0
      ? categoryExamIds
      : (examFilterId ? [Number(examFilterId)] : []);

    if (!categoryName.trim()) {
      toast.error("Category name is required");
      return;
    }
    if (effectiveCategoryExamIds.length === 0) {
      toast.error("Select at least one exam");
      return;
    }
    if (!editingCategoryId && selectedParentId && effectiveCategoryExamIds.length !== 1) {
      toast.error("For subcategory create, select exactly one exam.");
      return;
    }

    setIsSavingCategory(true);
    setFeedback("info", editingCategoryId ? `Updating category ID ${editingCategoryId}...` : "Creating category...");
    try {
      const payload = {
        name: categoryName,
        description: categoryDescription || null,
        parent_id: selectedParentId,
        exam_ids: effectiveCategoryExamIds,
      };
      if (editingCategoryId) {
        await premiumApi.put(`${premiumApiRoot}/api/v1/premium-categories/${quizTypeKey}/${editingCategoryId}`, payload);
        toast.success("Premium category updated");
        setFeedback("success", `Category ID ${editingCategoryId} updated.`);
      } else {
        await premiumApi.post(`${premiumApiRoot}/api/v1/premium-categories/${quizTypeKey}/`, payload);
        if (effectiveCategoryExamIds.length > 1) {
          toast.success(`Premium category created for ${effectiveCategoryExamIds.length} exams with separate IDs`);
          setFeedback("success", `Category created for ${effectiveCategoryExamIds.length} exams with separate IDs.`);
        } else {
          toast.success("Premium category created");
          setFeedback("success", "Category created.");
        }
      }
      resetCategoryForm();
      await loadCategories();
    } catch (error: unknown) {
      toast.error(editingCategoryId ? "Failed to update category" : "Failed to create category", {
        description: toErrorMessage(error),
      });
      setFeedback("error", editingCategoryId ? `Failed to update category ID ${editingCategoryId}.` : "Failed to create category.");
    } finally {
      setIsSavingCategory(false);
    }
  };

  const removeCategory = async (category: FlatCategoryNode) => {
    const confirmed = window.confirm(`Delete category "${category.name}" (ID ${category.id})?`);
    if (!confirmed) {
      setFeedback("info", `Category delete cancelled for ID ${category.id}.`);
      return;
    }
    setDeletingCategoryId(category.id);
    setFeedback("info", `Deleting category "${category.name}"...`);
    try {
      await premiumApi.delete(`${premiumApiRoot}/api/v1/premium-categories/${quizTypeKey}/${category.id}`);
      toast.success("Premium category deleted");
      setFeedback("success", `Category "${category.name}" deleted.`);
      if (editingCategoryId === category.id) {
        resetCategoryForm();
      }
      await loadCategories();
    } catch (error: unknown) {
      toast.error("Failed to delete category", { description: toErrorMessage(error) });
      setFeedback("error", `Failed to delete category "${category.name}".`);
    } finally {
      setDeletingCategoryId(null);
    }
  };

  const startBulkAddChildren = (category: FlatCategoryNode) => {
    const parentPath = findPathToCategory(categoryTree, category.id);
    setBulkParentPathIds(parentPath);
    if (category.exam_ids.length > 0) {
      setBulkExamIds(category.exam_ids);
    } else if (examFilterId) {
      setBulkExamIds([Number(examFilterId)]);
    } else {
      setBulkExamIds([]);
    }
    setFeedback("info", `Bulk parent set to "${category.name}" (ID ${category.id}).`);
  };

  const createBulkCategories = async () => {
    const categories = parseBulkCategoryInput(bulkCategoryInput);
    if (categories.length === 0) {
      toast.error("Add at least one category line for bulk create");
      return;
    }
    if (bulkExamIds.length === 0) {
      toast.error("Select at least one exam");
      return;
    }
    if (selectedBulkParentId && bulkExamIds.length !== 1) {
      toast.error("For subcategory bulk create, select exactly one exam.");
      return;
    }

    setIsSavingBulkCategory(true);
    setFeedback("info", "Creating bulk categories...");
    try {
      const response = await premiumApi.post<{
        message?: string;
        created_count?: number;
      }>(`${premiumApiRoot}/api/v1/premium-categories/${quizTypeKey}/bulk/`, {
        parent_id: selectedBulkParentId,
        exam_ids: bulkExamIds,
        categories,
      });
      const message = response.data?.message;
      if (typeof message === "string" && message.trim()) {
        toast.success(message);
        setFeedback("success", message);
      } else {
        toast.success(`Created ${response.data?.created_count ?? categories.length} categories`);
        setFeedback("success", `Created ${response.data?.created_count ?? categories.length} categories.`);
      }
      resetBulkForm();
      await loadCategories();
    } catch (error: unknown) {
      toast.error("Failed to create bulk categories", { description: toErrorMessage(error) });
      setFeedback("error", "Bulk category creation failed.");
    } finally {
      setIsSavingBulkCategory(false);
    }
  };

  return (
    <div className="space-y-6 rounded-md border bg-white p-5">
      <h2 className="text-lg font-bold">Exam and Premium Category Manager</h2>
      {actionFeedback ? (
        <div
          className={`rounded border px-3 py-2 text-xs ${
            actionFeedback.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : actionFeedback.tone === "error"
                ? "border-rose-200 bg-rose-50 text-rose-800"
                : "border-blue-200 bg-blue-50 text-blue-800"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <span>{actionFeedback.message}</span>
            <span className="whitespace-nowrap opacity-75">{actionFeedback.at}</span>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={createExam} className="space-y-2 rounded border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Exam Management</h3>
          <input
            value={examName}
            onChange={(event) => setExamName(event.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="exam name"
          />
          <input
            value={examSlug}
            onChange={(event) => setExamSlug(event.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="slug (optional)"
          />
          <input
            value={examDescription}
            onChange={(event) => setExamDescription(event.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="description"
          />
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={examActive} onChange={(event) => setExamActive(event.target.checked)} />
            active
          </label>
          <button type="submit" disabled={isSavingExam} className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {isSavingExam ? "Saving..." : "Create exam"}
          </button>
        </form>

        <div className="space-y-2 rounded border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Created Exams</h3>
          {editingExamId ? (
            <form onSubmit={saveExamEdit} className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">Edit Exam (ID {editingExamId})</p>
              <input
                value={editExamName}
                onChange={(event) => setEditExamName(event.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                placeholder="exam name"
              />
              <input
                value={editExamSlug}
                onChange={(event) => setEditExamSlug(event.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                placeholder="slug (optional)"
              />
              <input
                value={editExamDescription}
                onChange={(event) => setEditExamDescription(event.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                placeholder="description"
              />
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={editExamActive} onChange={(event) => setEditExamActive(event.target.checked)} />
                active
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={isUpdatingExam} className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {isUpdatingExam ? "Saving..." : "Update exam"}
                </button>
                <button type="button" onClick={() => cancelEditExam()} className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700">
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          <div className="space-y-2 text-sm">
            {exams.map((exam) => (
              <div key={exam.id} className="rounded border border-slate-100 px-3 py-2">
                <div>
                  <span className="font-medium">{exam.name}</span>
                  {exam.slug ? <span className="ml-2 text-xs text-slate-500">({exam.slug})</span> : null}
                  <span className="ml-2 text-xs text-slate-500">id: {exam.id}</span>
                  <span className={`ml-2 text-xs ${exam.is_active ? "text-emerald-600" : "text-slate-500"}`}>
                    {exam.is_active ? "active" : "inactive"}
                  </span>
                </div>
                {exam.description ? <p className="mt-1 text-xs text-slate-500">{exam.description}</p> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => startEditExam(exam)}
                    disabled={isUpdatingExam || deletingExamId === exam.id}
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-60"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => removeExam(exam)}
                    disabled={isUpdatingExam || deletingExamId === exam.id}
                    className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 disabled:opacity-60"
                  >
                    {deletingExamId === exam.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            ))}
            {exams.length === 0 ? <p className="text-slate-500">No exams yet.</p> : null}
          </div>
        </div>
      </div>

      <div className="rounded border border-slate-200 p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Category Context</h3>
        <div className="grid gap-2 md:grid-cols-2">
          <select
            value={quizType}
            onChange={(event) => {
              setQuizType(event.target.value as QuizKind);
              resetCategoryForm();
              resetBulkForm();
            }}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {QUIZ_TYPES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select value={examFilterId} onChange={(event) => handleCreateExamFilterChange(event.target.value)} className="rounded border border-slate-300 px-3 py-2 text-sm">
            <option value="">All exams</option>
            {exams.map((exam) => (
              <option key={exam.id} value={String(exam.id)}>
                {exam.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={saveCategory} className="space-y-3 rounded border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">
            {editingCategoryId ? "Edit Premium Category" : "Create Premium Category"}
          </h3>

          <input
            value={categoryName}
            onChange={(event) => setCategoryName(event.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="category name"
          />
          <input
            value={categoryDescription}
            onChange={(event) => setCategoryDescription(event.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="description"
          />

          <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-700">Parent category (step by step)</p>
            {createParentLevels.map((levelOptions, levelIndex) => (
              <select
                key={`create-parent-level-${levelIndex}`}
                value={String(parentPathIds[levelIndex] ?? "")}
                onChange={(event) => setCreatePathAtLevel(levelIndex, event.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">
                  {levelIndex === 0 ? "root category (no parent)" : `stop at level ${levelIndex} (use previous selection as parent)`}
                </option>
                {levelOptions.map((category) => (
                  <option key={category.id} value={String(category.id)}>
                    {category.name}
                  </option>
                ))}
              </select>
            ))}
            <p className="text-xs text-slate-500">
              Selected parent: {selectedParentId ? `ID ${selectedParentId}` : "root category"}
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Exam selected in dropdown is auto-selected below. Add extra exams only if you want this category in multiple exams.
          </p>

          <div className="max-h-32 overflow-y-auto rounded border border-slate-200 p-2 text-sm">
            <p className="mb-1 text-xs font-semibold text-slate-700">Exam scope (dropdown exam is preselected)</p>
            {exams.map((exam) => (
              <label key={exam.id} className="flex items-center gap-2 py-1">
                <input type="checkbox" checked={categoryExamIds.includes(exam.id)} onChange={() => toggleCategoryExam(exam.id)} />
                {exam.name}
              </label>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={isSavingCategory} className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {isSavingCategory ? "Saving..." : editingCategoryId ? "Update category" : "Create category"}
            </button>
            {editingCategoryId ? (
              <button type="button" onClick={resetCategoryForm} className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700">
                Cancel edit
              </button>
            ) : null}
          </div>
        </form>

        <div className="space-y-2 rounded border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Bulk Category</h3>
          <p className="text-xs text-slate-500">
            Add children under any parent category (root, subcategory, or deeper). Format: <code>name</code> or <code>name | description</code>.
          </p>

          <div className="max-h-32 overflow-y-auto rounded border border-slate-200 p-2 text-sm">
            <p className="mb-1 text-xs font-semibold text-slate-700">Exams</p>
            {exams.map((exam) => (
              <label key={exam.id} className="flex items-center gap-2 py-1">
                <input type="checkbox" checked={bulkExamIds.includes(exam.id)} onChange={() => toggleBulkExam(exam.id)} />
                {exam.name}
              </label>
            ))}
          </div>

          <div className="space-y-2 rounded border border-slate-200 bg-white p-2">
            <p className="text-xs font-semibold text-slate-700">Parent category path (step by step)</p>
            {bulkParentLevels.map((levelOptions, levelIndex) => (
              <select
                key={`bulk-parent-level-${levelIndex}`}
                value={String(bulkParentPathIds[levelIndex] ?? "")}
                onChange={(event) => setBulkPathAtLevel(levelIndex, event.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">
                  {levelIndex === 0 ? "root category (no parent)" : `stop at level ${levelIndex} (use previous selection as parent)`}
                </option>
                {levelOptions.map((category) => (
                  <option key={category.id} value={String(category.id)}>
                    {category.name}
                  </option>
                ))}
              </select>
            ))}
            <p className="text-xs text-slate-500">
              Selected parent: {selectedBulkParentId ? `ID ${selectedBulkParentId}` : "root category"}
            </p>
          </div>

          <p className="text-xs text-slate-500">
            Tip: click <code>Bulk Add Children</code> on any category row below to target that node directly.
          </p>

          <textarea
            value={bulkCategoryInput}
            onChange={(event) => setBulkCategoryInput(event.target.value)}
            className="min-h-[120px] w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder={"Economy\nPolity | Core constitutional topics\nModern History"}
          />
          <button
            type="button"
            onClick={createBulkCategories}
            disabled={isSavingBulkCategory}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
          >
            {isSavingBulkCategory ? "Creating..." : "Create bulk categories"}
          </button>
          <button type="button" onClick={resetBulkForm} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
            Reset bulk form
          </button>
        </div>
      </div>

      <div className="rounded border border-slate-200 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">Current category tree</span>
          <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{quizType}</span>
        </div>

        {isLoading ? (
          <p className="text-sm text-slate-500">Loading categories...</p>
        ) : flatCategories.length === 0 ? (
          <p className="text-sm text-slate-500">No categories created yet.</p>
        ) : (
          <div className="space-y-2 text-sm">
            {flatCategories.map((category) => (
              <div key={category.id} className="rounded border border-slate-100 px-3 py-2">
                <div style={{ paddingLeft: `${category.depth * 14}px` }}>
                  <span className="font-medium">
                    {category.depth > 0 ? "|- " : ""}
                    {category.name}
                  </span>
                  <span className="ml-2 text-xs text-slate-500">id: {category.id}</span>
                  {category.exam_ids.length > 0 ? (
                    <span className="ml-2 text-xs text-slate-500">exams: {category.exam_ids.join(", ")}</span>
                  ) : null}
                </div>
                {category.description ? <p className="mt-1 text-xs text-slate-500">{category.description}</p> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => startEditCategory(category)}
                    disabled={deletingCategoryId === category.id}
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-60"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => removeCategory(category)}
                    disabled={deletingCategoryId === category.id}
                    className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 disabled:opacity-60"
                  >
                    {deletingCategoryId === category.id ? "Deleting..." : "Delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => startBulkAddChildren(category)}
                    disabled={deletingCategoryId === category.id}
                    className="rounded border border-blue-200 px-2 py-1 text-xs text-blue-700 disabled:opacity-60"
                  >
                    Bulk Add Children
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
