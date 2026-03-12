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
    <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm transition focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100">
      <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50/80 p-2">
        <button type="button" aria-label="Bold" onClick={() => exec("bold")} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 transition hover:bg-slate-100">
          <BoldIcon size={14} />
        </button>
        <button type="button" aria-label="Italic" onClick={() => exec("italic")} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 transition hover:bg-slate-100">
          <ItalicIcon size={14} />
        </button>
        <button type="button" aria-label="Underline" onClick={() => exec("underline")} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 transition hover:bg-slate-100">
          <UnderlineIcon size={14} />
        </button>
        <button type="button" aria-label="Link" onClick={handleLink} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 transition hover:bg-slate-100">
          <LinkIcon size={14} />
        </button>
        <button type="button" aria-label="Bullets" onClick={() => exec("insertUnorderedList")} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 transition hover:bg-slate-100">
          <List size={14} />
        </button>
        <button type="button" aria-label="Numbered list" onClick={() => exec("insertOrderedList")} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 transition hover:bg-slate-100">
          <ListOrdered size={14} />
        </button>
        <div className="flex-1" />
        <button type="button" aria-label="Undo" onClick={() => exec("undo")} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 transition hover:bg-slate-100">
          <Undo size={14} />
        </button>
        <button type="button" aria-label="Redo" onClick={() => exec("redo")} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 transition hover:bg-slate-100">
          <Redo size={14} />
        </button>
      </div>
      <div
        ref={ref}
        contentEditable
        onInput={handleInput}
        data-placeholder={placeholder}
        suppressContentEditableWarning
        className="min-h-[140px] bg-white px-4 py-3 text-sm leading-6 text-slate-800 outline-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  );
}
