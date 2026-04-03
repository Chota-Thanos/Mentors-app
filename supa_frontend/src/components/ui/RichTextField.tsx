"use client";

import MiniRichTextInput from "@/components/ui/MiniRichTextInput";

type RichTextFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  helperText?: string;
  className?: string;
};

export default function RichTextField({
  label,
  value,
  onChange,
  placeholder,
  helperText,
  className = "",
}: RichTextFieldProps) {
  return (
    <div className={`space-y-2 ${className}`.trim()}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm font-semibold text-[var(--app-text)]">{label}</label>
        <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-secondary-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--app-secondary)]">
          Rich text
        </span>
      </div>
      {helperText ? <p className="text-xs leading-5 text-[var(--app-text-muted)]">{helperText}</p> : null}
      <MiniRichTextInput
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
    </div>
  );
}
