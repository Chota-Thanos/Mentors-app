import { normalizeRichTextValue } from "@/lib/richText";

type RichTextContentProps = {
  value: string | null | undefined;
  className?: string;
};

export default function RichTextContent({
  value,
  className = "",
}: RichTextContentProps) {
  const html = normalizeRichTextValue(String(value || ""));
  if (!html) return null;

  return (
    <div
      className={`prose prose-sm max-w-none text-slate-700 [&_a]:text-indigo-700 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_li]:my-0.5 [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-slate-100 [&_pre]:p-3 [&_strong]:font-semibold [&_ul]:pl-5 ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
