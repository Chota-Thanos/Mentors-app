const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "ul",
  "ol",
  "li",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "code",
  "pre",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "div",
  "span",
  "a",
]);

const BLOCKED_TAGS = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "svg",
  "math",
  "meta",
  "link",
  "base",
];

const STYLE_ALLOWED_PROPS = new Set([
  "font-weight",
  "font-style",
  "text-decoration",
  "color",
  "background-color",
  "font-size",
  "line-height",
  "text-align",
]);

const HTML_TAG_PATTERN = /<\s*[a-z][^>]*>/i;

function escapeHtml(raw: string): string {
  return String(raw || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMarkdownToHtml(raw: string): string {
  const escaped = escapeHtml(raw);
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>");
}

function sanitizeStyle(raw: string): string {
  const safe: string[] = [];
  const chunks = String(raw || "")
    .split(";")
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  for (const chunk of chunks) {
    const separatorIndex = chunk.indexOf(":");
    if (separatorIndex <= 0) continue;
    const prop = chunk.slice(0, separatorIndex).trim().toLowerCase();
    const value = chunk.slice(separatorIndex + 1).trim();
    if (!STYLE_ALLOWED_PROPS.has(prop)) continue;
    if (!value) continue;
    if (/[{}<>]/.test(value)) continue;
    if (/url\s*\(/i.test(value)) continue;
    safe.push(`${prop}: ${value}`);
    if (safe.length >= 12) break;
  }
  return safe.join("; ");
}

function sanitizeHref(raw: string): string {
  const href = String(raw || "").trim();
  if (!href) return "";
  if (/^(https?:|mailto:)/i.test(href)) return href;
  return "";
}

function sanitizeAllowedTag(tagName: string, attrSource: string): string {
  const tag = tagName.toLowerCase();
  if (tag === "br") return "<br />";

  let href = "";
  let style = "";
  const attrPattern = /([a-z0-9:-]+)\s*=\s*(".*?"|'.*?'|[^\s"'=<>`]+)/gi;
  let match: RegExpExecArray | null = null;
  while ((match = attrPattern.exec(attrSource))) {
    const attrName = String(match[1] || "").toLowerCase();
    const rawValue = String(match[2] || "").trim().replace(/^['"]|['"]$/g, "");
    if (tag === "a" && attrName === "href") {
      href = sanitizeHref(rawValue);
    }
    if ((tag === "span" || tag === "p" || tag === "div") && attrName === "style") {
      style = sanitizeStyle(rawValue);
    }
  }

  if (tag === "a") {
    return href
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">`
      : "<a>";
  }

  if (style) {
    return `<${tag} style="${escapeHtml(style)}">`;
  }

  return `<${tag}>`;
}

export function looksLikeRichTextHtml(raw: string): boolean {
  return HTML_TAG_PATTERN.test(String(raw || "").trim());
}

export function formatPlainTextToRichTextHtml(raw: string): string {
  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  const parts: string[] = [];
  let paragraphChunks: string[] = [];
  let inList = false;

  const flushParagraph = () => {
    if (paragraphChunks.length === 0) return;
    parts.push(`<p>${paragraphChunks.join(" ")}</p>`);
    paragraphChunks = [];
  };

  for (const sourceLine of lines) {
    const line = sourceLine.trim();
    if (!line) {
      flushParagraph();
      if (inList) {
        parts.push("</ul>");
        inList = false;
      }
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!inList) {
        parts.push("<ul>");
        inList = true;
      }
      parts.push(`<li>${inlineMarkdownToHtml(bullet[1])}</li>`);
      continue;
    }

    if (inList) {
      parts.push("</ul>");
      inList = false;
    }
    paragraphChunks.push(inlineMarkdownToHtml(line));
  }

  flushParagraph();
  if (inList) parts.push("</ul>");
  return parts.join("").trim();
}

export function sanitizeRichTextHtml(raw: string): string {
  const input = String(raw || "").trim();
  if (!input) return "";

  const blockedPattern = new RegExp(
    `<\\s*(${BLOCKED_TAGS.join("|")})\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>`,
    "gi",
  );

  return input
    .replace(blockedPattern, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<![\s\S]*?>/g, "")
    .replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (fullMatch, rawTagName, rawAttrs) => {
      const tagName = String(rawTagName || "").toLowerCase();
      if (!ALLOWED_TAGS.has(tagName)) return "";
      const isClosing = /^<\//.test(fullMatch);
      if (isClosing) return tagName === "br" ? "" : `</${tagName}>`;
      return sanitizeAllowedTag(tagName, String(rawAttrs || ""));
    })
    .trim();
}

export function normalizeRichTextValue(raw: string): string {
  const input = String(raw || "").trim();
  if (!input) return "";
  const htmlCandidate = looksLikeRichTextHtml(input)
    ? input
    : formatPlainTextToRichTextHtml(input);
  return sanitizeRichTextHtml(htmlCandidate);
}

export function richTextToPlainText(raw: string): string {
  const input = String(raw || "").trim();
  if (!input) return "";
  const prepared = looksLikeRichTextHtml(input)
    ? input
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|blockquote|h[1-6]|ul|ol|pre)>/gi, "\n")
        .replace(/<(li)\b[^>]*>/gi, "- ")
        .replace(/<[^>]+>/g, " ")
    : input;

  return prepared
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hasRichTextContent(raw: string): boolean {
  return richTextToPlainText(raw).replace(/\s+/g, " ").trim().length > 0;
}

export function toNullableRichText(raw: string): string | null {
  return hasRichTextContent(raw) ? normalizeRichTextValue(raw) : null;
}
