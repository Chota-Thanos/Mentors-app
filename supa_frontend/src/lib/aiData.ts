"use client";

import { createClient } from "@/lib/supabase/client";
import { pdfsApi } from "@/lib/backendServices";
import type {
  PremiumAIContentType,
  PremiumAIExampleAnalysis,
  PremiumCategory,
  PremiumCollection,
  QuizKind,
  UploadedPDF,
} from "@/types/premium";

type RowRecord = Record<string, unknown>;

type AiExampleAnalysisInput = {
  title: string;
  description?: string | null;
  exam_ids?: number[];
  tag_level1?: string | null;
  tag_level2?: string | null;
  style_profile: Record<string, unknown>;
  example_questions: string[];
  tags: string[];
  is_active?: boolean;
};

type CreateOwnedCollectionInput = {
  name: string;
  description?: string | null;
  collectionType: "prelims" | "mains";
  isPublic?: boolean;
  isPaid?: boolean;
  isFinalized?: boolean;
};

function asRecord(value: unknown): RowRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RowRecord)
    : {};
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  value.forEach((item) => {
    const normalized = String(item || "").trim();
    if (!normalized || output.includes(normalized)) return;
    output.push(normalized);
  });
  return output;
}

function normalizeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const output: number[] = [];
  value.forEach((item) => {
    const parsed = Number(item);
    if (!Number.isFinite(parsed) || parsed <= 0 || output.includes(parsed)) return;
    output.push(parsed);
  });
  return output;
}

function contentTypeToQuizDomain(contentType: PremiumAIContentType): "gk" | "maths" | "passage" | "mains" {
  switch (contentType) {
    case "premium_maths_quiz":
      return "maths";
    case "premium_passage_quiz":
      return "passage";
    case "mains_question_generation":
    case "mains_evaluation":
      return "mains";
    case "premium_gk_quiz":
    default:
      return "gk";
  }
}

function quizDomainToContentType(domain: unknown): PremiumAIContentType {
  switch (String(domain || "").trim().toLowerCase()) {
    case "maths":
      return "premium_maths_quiz";
    case "passage":
      return "premium_passage_quiz";
    case "mains":
      return "mains_question_generation";
    case "gk":
    default:
      return "premium_gk_quiz";
  }
}

export function buildPremiumCategoryTree(rows: PremiumCategory[]): PremiumCategory[] {
  const byId = new Map<number, PremiumCategory>();
  const roots: PremiumCategory[] = [];

  rows.forEach((row) => {
    byId.set(row.id, { ...row, children: [] });
  });

  byId.forEach((row) => {
    const parentId = row.parent_id ?? null;
    const parent = parentId ? byId.get(parentId) : null;
    if (parent) {
      parent.children = [...(parent.children || []), row];
      return;
    }
    roots.push(row);
  });

  return roots;
}

export async function fetchPremiumCategoryTree(quizKind: QuizKind): Promise<PremiumCategory[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, description, parent_id, domain")
    .eq("domain", quizKind)
    .eq("is_active", true)
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;

  const rows = (data ?? []).map((row) => ({
    id: Number(row.id),
    name: String(row.name || ""),
    description: row.description ? String(row.description) : null,
    parent_id: row.parent_id ? Number(row.parent_id) : null,
    type: String(row.domain || quizKind),
  }));

  return buildPremiumCategoryTree(rows);
}

export function mapAiExampleAnalysisRow(row: unknown): PremiumAIExampleAnalysis {
  const record = asRecord(row);
  const styleProfile = asRecord(record.style_profile);
  return {
    id: Number(record.id || 0),
    title: String(record.title || ""),
    description: record.description ? String(record.description) : null,
    tag_level1: record.tag_level1 ? String(record.tag_level1) : null,
    tag_level2: record.tag_level2 ? String(record.tag_level2) : null,
    content_type: quizDomainToContentType(record.quiz_domain),
    style_profile: styleProfile,
    example_questions: normalizeStringArray(record.example_questions),
    tags: normalizeStringArray(record.tags),
    exam_ids: normalizeNumberArray(record.exam_ids ?? styleProfile.exam_ids),
    is_active: record.is_active !== false,
    author_id: record.author_id ? String(record.author_id) : null,
    created_at: String(record.created_at || ""),
    updated_at: record.updated_at ? String(record.updated_at) : null,
  };
}

export async function fetchAiExampleAnalyses(contentType: PremiumAIContentType): Promise<PremiumAIExampleAnalysis[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("ai_example_analyses")
    .select("*")
    .eq("quiz_domain", contentTypeToQuizDomain(contentType))
    .eq("is_active", true)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => mapAiExampleAnalysisRow(row));
}

export async function upsertAiExampleAnalysis(
  contentType: PremiumAIContentType,
  payload: AiExampleAnalysisInput,
  id?: number | null,
): Promise<PremiumAIExampleAnalysis> {
  const supabase = createClient();
  const mergedStyleProfile = {
    ...payload.style_profile,
    exam_ids: normalizeNumberArray(payload.exam_ids),
  };
  const dbPayload = {
    title: payload.title,
    description: payload.description ?? null,
    quiz_domain: contentTypeToQuizDomain(contentType),
    tag_level1: payload.tag_level1 ?? null,
    tag_level2: payload.tag_level2 ?? null,
    style_profile: mergedStyleProfile,
    example_questions: payload.example_questions,
    tags: payload.tags,
    is_active: payload.is_active ?? true,
  };

  const query = id
    ? supabase.from("ai_example_analyses").update(dbPayload).eq("id", id).select("*").single()
    : supabase.from("ai_example_analyses").insert(dbPayload).select("*").single();

  const { data, error } = await query;
  if (error) throw error;
  return mapAiExampleAnalysisRow(data);
}

export async function deleteAiExampleAnalysis(id: number): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("ai_example_analyses").delete().eq("id", id);
  if (error) throw error;
}

export function mapUploadedPdfRow(row: unknown): UploadedPDF {
  const record = asRecord(row);
  return {
    id: Number(record.id || 0),
    filename: String(record.filename || ""),
    extracted_text: String(record.extracted_text || ""),
    uploader_id: String(record.user_id || record.uploader_id || ""),
    page_count: record.page_count == null ? null : Number(record.page_count),
    used_ocr: Boolean(record.used_ocr),
    created_at: String(record.created_at || ""),
    expires_at: record.expires_at ? String(record.expires_at) : null,
    message: record.message ? String(record.message) : null,
  };
}

export async function fetchUploadedPdfs(): Promise<UploadedPDF[]> {
  const rows = await pdfsApi.list();
  return rows.map((row) => mapUploadedPdfRow(row));
}

export function mapPremiumCollectionRow(row: unknown): PremiumCollection {
  const record = asRecord(row);
  const collectionType = String(record.collection_type || "prelims") === "mains" ? "mains" : "prelims";
  const priceValue = record.price == null ? null : Number(record.price);
  const name = String(record.name || "");
  return {
    id: Number(record.id || 0),
    title: name || `Test ${String(record.id || "")}`,
    name,
    description: record.description ? String(record.description) : null,
    test_kind: collectionType,
    is_public: Boolean(record.is_public),
    is_premium: Boolean(record.is_paid),
    is_paid: Boolean(record.is_paid),
    is_subscription: Boolean(record.is_subscription),
    price: Number.isFinite(priceValue) ? priceValue : null,
    image_url: record.image_url ? String(record.image_url) : null,
  };
}

export async function fetchOwnedCollections(
  profileId: number,
  collectionType: "prelims" | "mains",
): Promise<PremiumCollection[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("premium_collections")
    .select("id, name, description, collection_type, is_public, is_paid, is_subscription, price, image_url, created_at")
    .eq("creator_id", profileId)
    .eq("collection_type", collectionType)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => mapPremiumCollectionRow(row));
}

export async function createOwnedCollection(
  profileId: number,
  input: CreateOwnedCollectionInput,
): Promise<PremiumCollection> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("premium_collections")
    .insert({
      name: input.name,
      description: input.description ?? null,
      collection_type: input.collectionType,
      is_public: input.isPublic ?? false,
      is_paid: input.isPaid ?? false,
      is_finalized: input.isFinalized ?? false,
      creator_id: profileId,
    })
    .select("id, name, description, collection_type, is_public, is_paid, is_subscription, price, image_url")
    .single();

  if (error) throw error;
  return mapPremiumCollectionRow(data);
}
