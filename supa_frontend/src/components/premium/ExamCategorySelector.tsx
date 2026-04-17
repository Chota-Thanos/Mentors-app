"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { PremiumCategory, QuizKind } from "@/types/premium";

interface CategorySelectorProps {
  quizKind: QuizKind;
  selectedCategoryIds: number[];
  onCategoryIdsChange: (ids: number[]) => void;
  examId?: number | null;
}

type FlatCategoryNode = {
  id: number;
  name: string;
  depth: number;
};

function flattenCategories(nodes: PremiumCategory[], depth = 0): FlatCategoryNode[] {
  const output: FlatCategoryNode[] = [];
  for (const node of nodes) {
    output.push({ id: node.id, name: node.name, depth });
    if (Array.isArray(node.children) && node.children.length > 0) {
      output.push(...flattenCategories(node.children, depth + 1));
    }
  }
  return output;
}

function buildCategoryTree(rows: PremiumCategory[]): PremiumCategory[] {
  const byId = new Map<number, PremiumCategory>();
  const roots: PremiumCategory[] = [];
  for (const row of rows) {
    byId.set(row.id, { ...row, children: [] });
  }
  for (const row of byId.values()) {
    const parentId = row.parent_id ?? null;
    const parent = parentId ? byId.get(parentId) : null;
    if (parent) {
      parent.children = [...(parent.children || []), row];
    } else {
      roots.push(row);
    }
  }
  return roots;
}

export default function CategorySelector({
  quizKind,
  selectedCategoryIds,
  onCategoryIdsChange,
  examId,
}: CategorySelectorProps) {
  const [categories, setCategories] = useState<PremiumCategory[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  void examId;

  useEffect(() => {
    const loadCategories = async () => {
      setIsLoadingCategories(true);
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const { data, error } = await supabase
          .from("categories")
          .select("*")
          .eq("domain", quizKind)
          .eq("is_active", true)
          .order("display_order", { ascending: true })
          .order("name", { ascending: true });

        if (error) throw error;
        setCategories(buildCategoryTree((data || []) as unknown as PremiumCategory[]));
      } catch (error: unknown) {
        const description = error instanceof Error ? error.message : "Unknown error";
        toast.error("Failed to load categories", { description });
      } finally {
        setIsLoadingCategories(false);
      }
    };

    void loadCategories();
  }, [quizKind]);

  const flatCategories = useMemo(() => flattenCategories(categories), [categories]);

  const toggleCategory = (id: number) => {
    if (selectedCategoryIds.includes(id)) {
      onCategoryIdsChange(selectedCategoryIds.filter((item) => item !== id));
      return;
    }
    onCategoryIdsChange([...selectedCategoryIds, id]);
  };

  return (
    <div className="rounded-md border bg-slate-50 space-y-3 p-3">
      <div className="flex flex-col mb-2">
        <label className="block text-xs font-medium text-slate-600">Select Categories</label>
        <span className="text-xs text-slate-500">Pick one or more thematic scopes</span>
      </div>

      <div className="max-h-52 overflow-y-auto rounded border border-slate-200 bg-white p-2">
        {isLoadingCategories ? (
          <p className="text-sm text-slate-500">Loading categories...</p>
        ) : flatCategories.length === 0 ? (
          <p className="text-sm text-slate-500">No categories found.</p>
        ) : (
          <div className="space-y-1">
            {flatCategories.map((category) => (
              <label key={category.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedCategoryIds.includes(category.id)}
                  onChange={() => toggleCategory(category.id)}
                />
                <span style={{ paddingLeft: `${category.depth * 14}px` }}>
                  {category.depth > 0 ? "|- " : ""}
                  {category.name}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

