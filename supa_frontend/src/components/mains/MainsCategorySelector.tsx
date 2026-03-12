"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";

import { premiumApi } from "@/lib/premiumApi";
import type { MainsCategory } from "@/types/premium";

interface MainsCategorySelectorProps {
  selectedCategoryIds: number[];
  onCategoryIdsChange: (ids: number[]) => void;
}

type FlatMainsCategoryNode = {
  id: number;
  name: string;
  depth: number;
};

function flattenMainsCategories(nodes: MainsCategory[], depth = 0): FlatMainsCategoryNode[] {
  const output: FlatMainsCategoryNode[] = [];
  for (const node of nodes) {
    output.push({ id: node.id, name: node.name, depth });
    if (Array.isArray(node.children) && node.children.length > 0) {
      output.push(...flattenMainsCategories(node.children, depth + 1));
    }
  }
  return output;
}

export default function MainsCategorySelector({
  selectedCategoryIds,
  onCategoryIdsChange,
}: MainsCategorySelectorProps) {
  const [categories, setCategories] = useState<MainsCategory[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const loadCategories = async () => {
      setIsLoading(true);
      try {
        const response = await premiumApi.get<MainsCategory[]>("/mains/categories", {
          params: { hierarchical: true, active_only: true },
        });
        setCategories(Array.isArray(response.data) ? response.data : []);
      } catch (error: unknown) {
        const description = axios.isAxiosError(error) ? error.message : "Unknown error";
        toast.error("Failed to load mains categories", { description });
      } finally {
        setIsLoading(false);
      }
    };

    loadCategories();
  }, []);

  const flatCategories = useMemo(() => flattenMainsCategories(categories), [categories]);

  const toggleCategory = (id: number) => {
    if (selectedCategoryIds.includes(id)) {
      onCategoryIdsChange(selectedCategoryIds.filter((item) => item !== id));
      return;
    }
    onCategoryIdsChange([...selectedCategoryIds, id]);
  };

  return (
    <div className="rounded-md border bg-slate-50 space-y-2 p-3">
      <p className="text-xs text-slate-600">
        Select one or more mains categories. Attached category sources will be used when category source mode is enabled.
      </p>
      <div className="max-h-48 overflow-y-auto rounded border border-slate-200 bg-white p-2">
        {isLoading ? (
          <p className="text-sm text-slate-500">Loading mains categories...</p>
        ) : flatCategories.length === 0 ? (
          <p className="text-sm text-slate-500">No mains categories available.</p>
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
