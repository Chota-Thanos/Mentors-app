"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import AdminOnly from "@/components/auth/AdminOnly";
import AppLayout from "@/components/layouts/AppLayout";
import { legacyPremiumAiApi } from "@/lib/legacyPremiumAiApi";
import type { AIProvider, PremiumAIContentType, PremiumAIQuizInstruction } from "@/types/premium";

type Preset = {
  system_instructions: string;
  input_schema: Record<string, unknown>;
  example_input: string;
  output_schema: Record<string, unknown>;
  example_output: Record<string, unknown>;
};

const CONTENT_TYPES: PremiumAIContentType[] = [
  "premium_gk_quiz",
  "premium_maths_quiz",
  "premium_passage_quiz",
  "mains_question_generation",
  "mains_evaluation",
];

const PRESETS: Record<PremiumAIContentType, Preset> = {
  premium_gk_quiz: {
    system_instructions:
      "You are an expert in General Knowledge and creating multiple-choice questions for premium users. Generate premium GK quiz questions with four options (A-D), exactly one correct answer, and a strong explanation with option-level elimination. Include source_reference when possible. Follow the JSON schema strictly.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string" },
        difficulty: { type: "string", enum: ["easy", "medium", "hard", "advanced"] },
      },
      required: ["topic"],
    },
    example_input: "Generate an advanced difficulty Premium GK quiz question on Ancient Indian History.",
    output_schema: {
      type: "object",
      properties: {
        question_statement: { type: "string" },
        supp_question_statement: { type: ["string", "null"] },
        statements_facts: { type: ["array", "null"], items: { type: "string" } },
        question_prompt: { type: ["string", "null"] },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              text: { type: "string" },
              is_correct: { type: "boolean" },
            },
            required: ["label", "text", "is_correct"],
          },
        },
        correct_answer: { type: "string" },
        explanation: { type: ["string", "null"] },
        source_reference: { type: ["string", "null"] },
      },
      required: ["question_statement", "options", "correct_answer"],
    },
    example_output: {
      question_statement: "Consider the following statements regarding the Indus Valley Civilization (Premium Level):",
      statements_facts: [
        "Statement 1: The civilization was primarily urban.",
        "Statement 2: Iron was a commonly used metal.",
      ],
      options: [
        { label: "A", text: "Only Statement 1 is correct", is_correct: true },
        { label: "B", text: "Only Statement 2 is correct", is_correct: false },
        { label: "C", text: "Both Statements 1 and 2 are correct", is_correct: false },
        { label: "D", text: "Neither Statement 1 nor 2 is correct", is_correct: false },
      ],
      correct_answer: "A",
      explanation: "Statement 1 is correct. Indus Valley had advanced urban planning. Statement 2 is incorrect; iron was not the primary metal.",
      source_reference: "NCERT Ancient India",
    },
  },
  premium_maths_quiz: {
    system_instructions:
      "You are an expert in Mathematics and creating premium multiple-choice questions. Return one premium maths question with four options (A-D), one correct answer, and detailed explanation. Use LaTeX delimiters for formulas. Follow schema strictly.",
    input_schema: {
      type: "object",
      properties: {
        problem_description: { type: "string" },
        difficulty: { type: "string", enum: ["easy", "medium", "hard", "advanced"] },
      },
      required: ["problem_description"],
    },
    example_input: "Generate an advanced math quiz question about complex numbers.",
    output_schema: {
      type: "object",
      properties: {
        question_statement: { type: "string" },
        supp_question_statement: { type: ["string", "null"] },
        statements_facts: { type: ["array", "null"], items: { type: "string" } },
        question_prompt: { type: ["string", "null"] },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              text: { type: "string" },
              is_correct: { type: "boolean" },
            },
            required: ["label", "text", "is_correct"],
          },
        },
        correct_answer: { type: "string" },
        explanation: { type: ["string", "null"] },
        source_reference: { type: ["string", "null"] },
      },
      required: ["question_statement", "options", "correct_answer"],
    },
    example_output: {
      question_statement: "A complex number z satisfies |z - 1| = |z + i|. Find the locus of z.",
      options: [
        { label: "A", text: "A circle", is_correct: false },
        { label: "B", text: "A straight line", is_correct: true },
        { label: "C", text: "An ellipse", is_correct: false },
        { label: "D", text: "A parabola", is_correct: false },
      ],
      correct_answer: "B",
      explanation: "Locus is the perpendicular bisector of two fixed points, so it is a straight line.",
    },
  },
  premium_passage_quiz: {
    system_instructions:
      "You are an expert in reading comprehension and premium passage quiz generation. Return passage_title, passage_text, source_reference and an array of questions. Each question needs statement, options, correct answer, and explanation.",
    input_schema: {
      type: "object",
      properties: {
        passage_topic: { type: "string" },
        num_questions: { type: "integer" },
        difficulty: { type: "string", enum: ["medium", "hard", "advanced"] },
      },
      required: ["passage_topic", "num_questions"],
    },
    example_input: "Generate 3 advanced difficulty quiz questions for a passage on The Future of Artificial Intelligence.",
    output_schema: {
      type: "object",
      properties: {
        passage_title: { type: ["string", "null"] },
        passage_text: { type: "string" },
        source_reference: { type: ["string", "null"] },
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question_statement: { type: "string" },
              supp_question_statement: { type: ["string", "null"] },
              statements_facts: { type: ["array", "null"], items: { type: "string" } },
              question_prompt: { type: ["string", "null"] },
              options: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    text: { type: "string" },
                    is_correct: { type: "boolean" },
                  },
                  required: ["label", "text", "is_correct"],
                },
              },
              correct_answer: { type: "string" },
              explanation: { type: ["string", "null"] },
            },
            required: ["question_statement", "options", "correct_answer"],
          },
        },
      },
      required: ["passage_text", "questions"],
    },
    example_output: {
      passage_title: "The Importance of Renewable Energy",
      passage_text: "Renewable energy sources like solar, wind, and hydro power are crucial for combating climate change...",
      source_reference: "UNEP report",
      questions: [
        {
          question_statement: "What is a key benefit of renewable energy sources mentioned in the passage?",
          options: [
            { label: "A", text: "They are finite resources.", is_correct: false },
            { label: "B", text: "They produce significant greenhouse gases.", is_correct: false },
            { label: "C", text: "They are naturally replenished.", is_correct: true },
            { label: "D", text: "They increase reliance on global energy markets.", is_correct: false },
          ],
          correct_answer: "C",
          explanation: "The passage states renewable sources are naturally replenished.",
        },
      ],
    },
  },
  mains_question_generation: {
    system_instructions:
      "You are an expert UPSC Mains exam question setter. Generate high-quality Mains questions with answer_approach and model_answer.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string" },
        sub_topics: { type: "array", items: { type: "string" } },
        difficulty: { type: "string", enum: ["moderate", "difficult"] },
      },
      required: ["topic"],
    },
    example_input: "Topic: Urbanization in India. Sub-topics: Smart Cities, Slum development.",
    output_schema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question_text: { type: "string" },
              answer_approach: { type: "string" },
              model_answer: { type: "string" },
              word_limit: { type: "integer" },
            },
            required: ["question_text", "answer_approach", "model_answer"],
          },
        },
      },
      required: ["questions"],
    },
    example_output: {
      questions: [
        {
          question_text: "Discuss the impact of climate change on Indian agriculture.",
          answer_approach: "Introduction-body-conclusion structure.",
          model_answer: "Climate change poses significant threats...",
          word_limit: 250,
        },
      ],
    },
  },
  mains_evaluation: {
    system_instructions:
      "You are an expert UPSC Mains answer evaluator. Score out of 10, provide feedback, strengths, weaknesses, and improved answer.",
    input_schema: {
      type: "object",
      properties: {
        question_text: { type: "string" },
        answer_text: { type: "string" },
        model_answer: { type: ["string", "null"] },
      },
      required: ["question_text", "answer_text"],
    },
    example_input: "Question and user answer text",
    output_schema: {
      type: "object",
      properties: {
        score: { type: "number" },
        max_score: { type: "number" },
        feedback: { type: "string" },
        strengths: { type: "array", items: { type: "string" } },
        weaknesses: { type: "array", items: { type: "string" } },
        improved_answer: { type: "string" },
      },
      required: ["score", "feedback", "strengths", "weaknesses"],
    },
    example_output: {
      score: 6.5,
      max_score: 10,
      feedback: "Good structure but lacks data-backed examples.",
      strengths: ["Clear language"],
      weaknesses: ["Needs evidence"],
      improved_answer: "Revised answer text...",
    },
  },
};

type FormState = {
  content_type: PremiumAIContentType;
  ai_provider: AIProvider;
  ai_model_name: string;
  system_instructions: string;
  input_schema: string;
  example_input: string;
  output_schema: string;
  example_output: string;
};

function formFromPreset(contentType: PremiumAIContentType): FormState {
  const preset = PRESETS[contentType];
  return {
    content_type: contentType,
    ai_provider: "gemini",
    ai_model_name: "gemini-3-flash-preview",
    system_instructions: preset.system_instructions,
    input_schema: JSON.stringify(preset.input_schema, null, 2),
    example_input: preset.example_input,
    output_schema: JSON.stringify(preset.output_schema, null, 2),
    example_output: JSON.stringify(preset.example_output, null, 2),
  };
}

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  if (typeof error.response?.data?.detail === "string") return error.response.data.detail;
  return error.message;
}

export default function PremiumAISettingsPage() {
  const [items, setItems] = useState<PremiumAIQuizInstruction[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [useCustomSchema, setUseCustomSchema] = useState(false);
  const [form, setForm] = useState<FormState>(formFromPreset("premium_gk_quiz"));

  const selectedItem = useMemo(
    () => (selectedId === null ? null : items.find((item) => item.id === selectedId) || null),
    [items, selectedId],
  );

  const load = async () => {
    setLoading(true);
    try {
      const response = await legacyPremiumAiApi.get<PremiumAIQuizInstruction[]>("/admin/premium-ai-settings/");
      setItems(response.data || []);
    } catch (error: unknown) {
      toast.error("Failed to load premium AI instructions", { description: toError(error) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selectedItem) return;
    setForm({
      content_type: selectedItem.content_type,
      ai_provider: selectedItem.ai_provider,
      ai_model_name: selectedItem.ai_model_name || "gemini-3-flash-preview",
      system_instructions: selectedItem.system_instructions || "",
      input_schema: JSON.stringify(selectedItem.input_schema || {}, null, 2),
      example_input: selectedItem.example_input || "",
      output_schema: JSON.stringify(selectedItem.output_schema || {}, null, 2),
      example_output: JSON.stringify(selectedItem.example_output || {}, null, 2),
    });
    setUseCustomSchema(true);
  }, [selectedItem]);

  const resetNew = () => {
    setSelectedId(null);
    setUseCustomSchema(false);
    setForm(formFromPreset("premium_gk_quiz"));
  };

  const applyPresetForType = (contentType: PremiumAIContentType) => {
    if (useCustomSchema) return;
    const preset = formFromPreset(contentType);
    setForm((prev) => ({
      ...prev,
      content_type: contentType,
      system_instructions: preset.system_instructions,
      input_schema: preset.input_schema,
      example_input: preset.example_input,
      output_schema: preset.output_schema,
      example_output: preset.example_output,
    }));
  };

  const save = async () => {
    let inputSchema: Record<string, unknown>;
    let outputSchema: Record<string, unknown>;
    let exampleOutput: Record<string, unknown>;
    try {
      inputSchema = form.input_schema.trim() ? JSON.parse(form.input_schema) : {};
      outputSchema = form.output_schema.trim() ? JSON.parse(form.output_schema) : {};
      exampleOutput = form.example_output.trim() ? JSON.parse(form.example_output) : {};
    } catch {
      toast.error("Invalid JSON in schema/example fields");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        content_type: form.content_type,
        ai_provider: form.ai_provider,
        ai_model_name: form.ai_model_name || "gemini-3-flash-preview",
        system_instructions: form.system_instructions,
        input_schema: inputSchema,
        example_input: form.example_input || null,
        output_schema: outputSchema,
        example_output: exampleOutput,
      };

      if (selectedId !== null) {
        await legacyPremiumAiApi.put(`/admin/premium-ai-settings/${selectedId}`, payload);
        toast.success("Premium AI instruction updated");
      } else {
        await legacyPremiumAiApi.post("/admin/premium-ai-settings/", payload);
        toast.success("Premium AI instruction created");
      }
      await load();
      resetNew();
    } catch (error: unknown) {
      toast.error("Failed to save instruction", { description: toError(error) });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm("Delete this instruction?")) return;
    try {
      await legacyPremiumAiApi.delete(`/admin/premium-ai-settings/${id}`);
      toast.success("Instruction deleted");
      if (selectedId === id) resetNew();
      await load();
    } catch (error: unknown) {
      toast.error("Failed to delete instruction", { description: toError(error) });
    }
  };

  return (
    <AdminOnly>
      <AppLayout adminNav>
        <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Premium AI Instructions</h1>
          <p className="mt-2 text-sm text-slate-500">
            Full settings for premium GK/Maths/Passage generation and mains instruction variants.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Existing Instructions</h2>
              <button onClick={resetNew} className="rounded border border-slate-300 px-2 py-1 text-xs">New</button>
            </div>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading...</div>
            ) : items.length === 0 ? (
              <p className="text-sm text-slate-500">No instructions yet.</p>
            ) : (
              <div className="space-y-2">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className={`cursor-pointer rounded border p-2 text-sm ${selectedId === item.id ? "border-slate-900 bg-slate-50" : "border-slate-200"}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <p className="font-medium text-slate-900">{item.content_type}</p>
                    <p className="text-xs text-slate-500">{item.ai_provider} / {item.ai_model_name}</p>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        remove(item.id);
                      }}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-red-600"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">{selectedId !== null ? "Edit Instruction" : "Create Instruction"}</h2>
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <select
                  value={form.content_type}
                  onChange={(event) => {
                    const next = event.target.value as PremiumAIContentType;
                    setForm((prev) => ({ ...prev, content_type: next }));
                    applyPresetForType(next);
                  }}
                  disabled={selectedId !== null}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  {CONTENT_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
                <select
                  value={form.ai_provider}
                  onChange={(event) => setForm((prev) => ({ ...prev, ai_provider: event.target.value as AIProvider }))}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="gemini">gemini</option>
                  <option value="openai">openai</option>
                  <option value="perplexity">perplexity</option>
                </select>
                <input
                  value={form.ai_model_name}
                  onChange={(event) => setForm((prev) => ({ ...prev, ai_model_name: event.target.value }))}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                  placeholder="ai_model_name"
                />
              </div>

              <textarea value={form.system_instructions} onChange={(event) => setForm((prev) => ({ ...prev, system_instructions: event.target.value }))} className="min-h-[170px] w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="system_instructions" />
              <textarea value={form.input_schema} onChange={(event) => setForm((prev) => ({ ...prev, input_schema: event.target.value }))} className="min-h-[140px] w-full rounded border border-slate-300 px-3 py-2 font-mono text-xs" placeholder="input_schema JSON" />
              <textarea value={form.example_input} onChange={(event) => setForm((prev) => ({ ...prev, example_input: event.target.value }))} className="min-h-[80px] w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="example_input" />

              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={useCustomSchema} onChange={(event) => setUseCustomSchema(event.target.checked)} disabled={selectedId !== null} />
                Use custom output schema
              </label>

              <textarea value={form.output_schema} onChange={(event) => setForm((prev) => ({ ...prev, output_schema: event.target.value }))} readOnly={!useCustomSchema} className="min-h-[170px] w-full rounded border border-slate-300 px-3 py-2 font-mono text-xs" placeholder="output_schema JSON" />
              <textarea value={form.example_output} onChange={(event) => setForm((prev) => ({ ...prev, example_output: event.target.value }))} readOnly={!useCustomSchema} className="min-h-[170px] w-full rounded border border-slate-300 px-3 py-2 font-mono text-xs" placeholder="example_output JSON" />

              <button onClick={save} disabled={saving} className="inline-flex items-center rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {selectedId !== null ? "Update instruction" : "Create instruction"}
              </button>
            </div>
          </div>
        </div>
        </div>
      </AppLayout>
    </AdminOnly>
  );
}
