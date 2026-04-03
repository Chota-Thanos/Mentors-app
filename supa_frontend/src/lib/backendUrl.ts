const stripTrailingSlash = (value: string): string => value.replace(/\/$/, "");

const normalizeBackendRoot = (value: string | undefined): string => {
  const normalized = stripTrailingSlash(String(value || "").trim());
  if (!normalized) return "";
  if (normalized.toLowerCase() === "auto") return "";
  return normalized.replace(/\/api\/v1(?:\/.*)?$/i, "");
};

const inferBrowserBackendRoot = (): string => {
  if (typeof window === "undefined") return "";
  const hostname = String(window.location.hostname || "").trim();
  if (!hostname) return "";

  const configuredPort = String(
    process.env.NEXT_PUBLIC_SUPA_BACKEND_PORT
    || process.env.NEXT_PUBLIC_API_PORT
    || "8002",
  ).trim();

  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  return `${protocol}//${hostname}${configuredPort ? `:${configuredPort}` : ""}`;
};

const configuredRoot =
  normalizeBackendRoot(process.env.NEXT_PUBLIC_SUPA_BACKEND_URL)
  || normalizeBackendRoot(process.env.NEXT_PUBLIC_API_URL);

export const backendRoot = configuredRoot || inferBrowserBackendRoot() || "http://localhost:8002";
