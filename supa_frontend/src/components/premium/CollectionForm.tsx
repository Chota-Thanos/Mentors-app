"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import axios from "axios";

import { premiumApi } from "@/lib/premiumApi";
import { toNullableRichText } from "@/lib/richText";
import RichTextField from "@/components/ui/RichTextField";
import type { PremiumCategory } from "@/types/premium";

type SourceLink = { title: string; url: string };

export default function CollectionForm() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [categories, setCategories] = useState<PremiumCategory[]>([]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState(0);
  const [isPremium, setIsPremium] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [isFinalized, setIsFinalized] = useState(false);
  const [isSubscription, setIsSubscription] = useState(false);
  const [isPrivateSource, setIsPrivateSource] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [adminSubpageId, setAdminSubpageId] = useState("");
  const [sourcePdfUrl, setSourcePdfUrl] = useState("");
  const [sourceContentHtml, setSourceContentHtml] = useState("");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [sourceList, setSourceList] = useState<SourceLink[]>([{ title: "", url: "" }]);

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const response = await premiumApi.get<PremiumCategory[]>("/categories");
        setCategories(response.data || []);
      } catch (error: unknown) {
        const description = axios.isAxiosError(error) ? error.message : "Unknown error";
        toast.error("Failed to load categories", { description });
      }
    };
    loadCategories();
  }, []);

  const toggleCategory = (id: number) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const updateSource = (index: number, patch: Partial<SourceLink>) => {
    setSourceList((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const addSource = () => setSourceList((prev) => [...prev, { title: "", url: "" }]);
  const removeSource = (index: number) =>
    setSourceList((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    try {
      const payload = {
        title: name,
        description: toNullableRichText(description),
        price: Number(price),
        is_premium: isPremium,
        is_public: isPublic,
        is_finalized: isFinalized,
        type: "test_series",
        test_kind: "prelims",
        thumbnail_url: thumbnailUrl || null,
        category_ids: selectedCategoryIds,
        source_list: sourceList.filter((item) => item.url.trim().length > 0),
        source_category_ids: selectedCategoryIds,
        source_pdf_url: sourcePdfUrl || null,
        source_content_html: sourceContentHtml || null,
        admin_subpage_id: adminSubpageId ? Number(adminSubpageId) : null,
        is_subscription: isSubscription,
        is_private_source: isPrivateSource,
        meta: {
          collection_mode: "prelims_quiz",
          test_kind: "prelims",
        },
      };

      const response = await premiumApi.post("/collections", payload);
      toast.success("Prelims Test created");
      router.push(`/collections/${response.data.id}`);
      router.refresh();
    } catch (error: unknown) {
      const description = axios.isAxiosError(error)
        ? (typeof error.response?.data?.detail === "string" ? error.response.data.detail : error.message)
        : "Unknown error";
      toast.error("Failed to create Prelims Test", {
        description,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-md border bg-white space-y-6 p-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-900">Prelims Test name</label>
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="All India Prelims Programs 2026"
          />
        </div>

        <div className="md:col-span-2">
          <RichTextField
            label="Description"
            value={description}
            onChange={setDescription}
            placeholder="Describe the test scope, difficulty, intended learner segment, and what this collection includes."
            helperText="This description appears on collection cards and the collection detail page."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-900">Price (INR)</label>
          <input
            type="number"
            min={0}
            value={price}
            onChange={(event) => setPrice(Number(event.target.value))}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-900">Admin Subpage ID</label>
          <input
            value={adminSubpageId}
            onChange={(event) => setAdminSubpageId(event.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="optional numeric id"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-900">Image URL</label>
          <input
            value={thumbnailUrl}
            onChange={(event) => setThumbnailUrl(event.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="https://example.com/collection-cover.jpg"
          />
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {[
          { label: "Premium", value: isPremium, setValue: setIsPremium },
          { label: "Public", value: isPublic, setValue: setIsPublic },
          { label: "Finalized", value: isFinalized, setValue: setIsFinalized },
          { label: "Subscription", value: isSubscription, setValue: setIsSubscription },
          { label: "Private source", value: isPrivateSource, setValue: setIsPrivateSource },
        ].map((item) => (
          <label key={item.label} className="flex items-center gap-2 rounded border border-slate-200 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={item.value}
              onChange={(event) => item.setValue(event.target.checked)}
            />
            {item.label}
          </label>
        ))}
      </div>

      <div>
        <p className="text-sm font-medium text-slate-900">Category assignment</p>
        <div className="mt-2 grid max-h-44 gap-2 overflow-y-auto rounded border border-slate-200 p-3 md:grid-cols-2">
          {categories.map((category) => (
            <label key={category.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedCategoryIds.includes(category.id)}
                onChange={() => toggleCategory(category.id)}
              />
              <span>{category.name}</span>
              <span className="text-xs text-slate-400">({category.type})</span>
            </label>
          ))}
        </div>
      </div>

      <div className="rounded border border-slate-200 p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-900">Source list</p>
          <button type="button" onClick={addSource} className="inline-flex items-center gap-1 text-sm text-indigo-600">
            <Plus className="h-4 w-4" />
            Add source
          </button>
        </div>
        <div className="space-y-3">
          {sourceList.map((item, index) => (
            <div key={index} className="grid gap-2 md:grid-cols-[1fr_2fr_auto]">
              <input
                value={item.title}
                onChange={(event) => updateSource(index, { title: event.target.value })}
                className="rounded border border-slate-300 px-3 py-2 text-sm"
                placeholder="Source title"
              />
              <input
                value={item.url}
                onChange={(event) => updateSource(index, { url: event.target.value })}
                className="rounded border border-slate-300 px-3 py-2 text-sm"
                placeholder="https://..."
              />
              <button
                type="button"
                onClick={() => removeSource(index)}
                className="inline-flex items-center justify-center rounded border border-slate-200 px-2 text-slate-500 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-900">Source PDF URL</label>
          <input
            value={sourcePdfUrl}
            onChange={(event) => setSourcePdfUrl(event.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="https://..."
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-900">Source content (HTML/text)</label>
          <textarea
            rows={4}
            value={sourceContentHtml}
            onChange={(event) => setSourceContentHtml(event.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="flex justify-end gap-3 border-t border-slate-200 pt-5">
        <button type="button" onClick={() => router.back()} className="rounded border border-slate-300 px-4 py-2 text-sm">
          Cancel
        </button>
        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex items-center rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {isLoading ? "Creating..." : "Create Prelims Test"}
        </button>
      </div>
    </form>
  );
}

