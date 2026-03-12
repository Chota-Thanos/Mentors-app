export type OutputLanguage = "en" | "hi";

export const OUTPUT_LANGUAGE_STORAGE_KEY = "supa-output-language";

export const OUTPUT_LANGUAGE_OPTIONS: Array<{ value: OutputLanguage; label: string }> = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi (हिंदी)" },
];

export function normalizeOutputLanguage(value: unknown): OutputLanguage {
  return String(value || "").trim().toLowerCase() === "hi" ? "hi" : "en";
}

export function readOutputLanguage(): OutputLanguage {
  if (typeof window === "undefined") return "en";
  return normalizeOutputLanguage(window.localStorage.getItem(OUTPUT_LANGUAGE_STORAGE_KEY));
}

export function persistOutputLanguage(value: unknown): OutputLanguage {
  const normalized = normalizeOutputLanguage(value);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(OUTPUT_LANGUAGE_STORAGE_KEY, normalized);
  }
  return normalized;
}
