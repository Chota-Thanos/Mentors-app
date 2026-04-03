"use client";

import React, { useEffect, useMemo, useRef } from "react";
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Underline as UnderlineIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  Undo,
  Redo,
} from "lucide-react";

import { normalizeRichTextValue } from "@/lib/richText";

type MiniRichTextInputProps = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
};

const exec = (command: string, value?: string) => {
  document.execCommand(command, false, value);
};

export default function MiniRichTextInput({
  value,
  onChange,
  placeholder,
}: MiniRichTextInputProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const normalizedValue = useMemo(() => normalizeRichTextValue(value), [value]);

  useEffect(() => {
    if (!ref.current) return;
    if (ref.current.innerHTML !== normalizedValue) {
      ref.current.innerHTML = normalizedValue;
    }
  }, [normalizedValue]);

  const handleInput = () => {
    onChange(ref.current?.innerHTML || "");
  };

  const handleLink = () => {
    const url = window.prompt("Enter URL");
    if (!url) return;
    exec("createLink", url);
  };

  return (
    <div className="overflow-hidden rounded-[24px] border border-[var(--app-border)] bg-[var(--app-surface)] shadow-[var(--app-shadow-soft)] transition focus-within:border-[var(--app-border-strong)] focus-within:ring-4 focus-within:ring-[var(--app-focus)]">
      <div className="flex flex-wrap gap-2 border-b border-[var(--app-border)] bg-[var(--app-surface-soft)]/90 p-2">
        <button type="button" aria-label="Bold" onClick={() => exec("bold")} className="app-btn-secondary rounded-2xl p-2 text-[var(--app-text-muted)]">
          <BoldIcon size={14} />
        </button>
        <button type="button" aria-label="Italic" onClick={() => exec("italic")} className="app-btn-secondary rounded-2xl p-2 text-[var(--app-text-muted)]">
          <ItalicIcon size={14} />
        </button>
        <button type="button" aria-label="Underline" onClick={() => exec("underline")} className="app-btn-secondary rounded-2xl p-2 text-[var(--app-text-muted)]">
          <UnderlineIcon size={14} />
        </button>
        <button type="button" aria-label="Link" onClick={handleLink} className="app-btn-secondary rounded-2xl p-2 text-[var(--app-text-muted)]">
          <LinkIcon size={14} />
        </button>
        <button type="button" aria-label="Bullets" onClick={() => exec("insertUnorderedList")} className="app-btn-secondary rounded-2xl p-2 text-[var(--app-text-muted)]">
          <List size={14} />
        </button>
        <button type="button" aria-label="Numbered list" onClick={() => exec("insertOrderedList")} className="app-btn-secondary rounded-2xl p-2 text-[var(--app-text-muted)]">
          <ListOrdered size={14} />
        </button>
        <div className="flex-1" />
        <button type="button" aria-label="Undo" onClick={() => exec("undo")} className="app-btn-secondary rounded-2xl p-2 text-[var(--app-text-muted)]">
          <Undo size={14} />
        </button>
        <button type="button" aria-label="Redo" onClick={() => exec("redo")} className="app-btn-secondary rounded-2xl p-2 text-[var(--app-text-muted)]">
          <Redo size={14} />
        </button>
      </div>
      <div
        ref={ref}
        contentEditable
        onInput={handleInput}
        data-placeholder={placeholder}
        suppressContentEditableWarning
        className="min-h-[140px] bg-[var(--app-surface)] px-4 py-3 text-sm leading-6 text-[var(--app-text)] outline-none empty:before:text-[var(--app-text-soft)] empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  );
}
