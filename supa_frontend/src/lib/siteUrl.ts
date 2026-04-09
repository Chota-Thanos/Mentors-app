const normalizeSiteUrl = (value?: string | null) => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, "");
};

export const getPublicSiteUrl = () => {
  const configuredUrl = normalizeSiteUrl(
    process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_FRONTEND_URL
  );

  if (configuredUrl) {
    return configuredUrl;
  }

  if (typeof window !== "undefined") {
    return normalizeSiteUrl(window.location.origin) ?? window.location.origin;
  }

  return null;
};
