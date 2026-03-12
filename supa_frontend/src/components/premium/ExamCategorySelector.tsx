"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";

import { premiumApi, premiumApiRoot } from "@/lib/premiumApi";
import type { PremiumCategory, PremiumExam, QuizKind } from "@/types/premium";

interface ExamCategorySelectorProps {
  quizKind: QuizKind;
  selectedExamId: number | null;
  selectedCategoryIds: number[];
  onExamChange: (examId: number | null) => void;
  onCategoryIdsChange: (ids: number[]) => void;
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

export default function ExamCategorySelector({
  quizKind,
  selectedExamId,
  selectedCategoryIds,
  onExamChange,
  onCategoryIdsChange,
}: ExamCategorySelectorProps) {
  const [exams, setExams] = useState<PremiumExam[]>([]);
  const [categories, setCategories] = useState<PremiumCategory[]>([]);
  const [isLoadingExams, setIsLoadingExams] = useState(false);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);

  useEffect(() => {
    const loadExams = async () => {
      setIsLoadingExams(true);
      try {
        const response = await premiumApi.get<PremiumExam[]>("/exams", { params: { active_only: true } });
        const data = response.data || [];
        setExams(data);
        if (data.length > 0 && selectedExamId === null) {
          onExamChange(data[0].id);
        }
      } catch (error: unknown) {
        const description = axios.isAxiosError(error) ? error.message : "Unknown error";
        toast.error("Failed to load exams", { description });
      } finally {
        setIsLoadingExams(false);
      }
    };

    loadExams();
  }, [onExamChange, selectedExamId]);

  useEffect(() => {
    const loadCategories = async () => {
      if (!selectedExamId) {
        setCategories([]);
        return;
      }

      setIsLoadingCategories(true);
      try {
        const quizType = `premium_${quizKind}`;
        const response = await axios.get<PremiumCategory[]>(
          `${premiumApiRoot}/api/v1/premium-categories/${quizType}/`,
          {
            params: {
              hierarchical: true,
              exam_id: selectedExamId,
            },
          },
        );
        setCategories(response.data || []);
      } catch (error: unknown) {
        const description = axios.isAxiosError(error) ? error.message : "Unknown error";
        toast.error("Failed to load categories", { description });
      } finally {
        setIsLoadingCategories(false);
      }
    };

    loadCategories();
  }, [quizKind, selectedExamId]);

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
      <div className="grid gap-2 md:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-slate-600">Exam</label>
          <select
            value={selectedExamId ?? ""}
            onChange={(event) => onExamChange(event.target.value ? Number(event.target.value) : null)}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
            disabled={isLoadingExams}
          >
            <option value="">{isLoadingExams ? "Loading exams..." : "Select exam"}</option>
            {exams.map((exam) => (
              <option key={exam.id} value={String(exam.id)}>
                {exam.name}
              </option>
            ))}
          </select>
        </div>
        <div className="text-xs text-slate-500 md:pt-6">
          Choose exam first, then select one or more categories for posting.
        </div>
      </div>

      <div className="max-h-52 overflow-y-auto rounded border border-slate-200 bg-white p-2">
        {isLoadingCategories ? (
          <p className="text-sm text-slate-500">Loading categories...</p>
        ) : flatCategories.length === 0 ? (
          <p className="text-sm text-slate-500">No categories found for selected exam.</p>
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

