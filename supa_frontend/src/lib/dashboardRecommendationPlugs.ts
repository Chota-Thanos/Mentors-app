import type { DashboardRecommendationPlug } from "@/types/premium";

export interface DashboardPlugTarget {
  href: string;
  label: string;
  external?: boolean;
}

type DashboardPlugResolver = (plug: DashboardRecommendationPlug) => DashboardPlugTarget | null;

const DASHBOARD_PLUG_RESOLVERS: Partial<Record<string, DashboardPlugResolver>> = {
  practice_weak_area: (plug) => {
    const section = String(plug.section || "").trim();
    if (!section) return null;
    return {
      href: `/dashboard/${encodeURIComponent(section)}`,
      label: "Open Section Detail",
    };
  },
  mentorship_support: () => ({
    href: "/mentorship/manage",
    label: "Open Mentorship",
  }),
  course_enrollment: () => ({
    href: "/test-series",
    label: "Browse Test Series",
  }),
};

export function resolveDashboardRecommendationPlug(
  plug: DashboardRecommendationPlug,
): DashboardPlugTarget | null {
  const resolver = DASHBOARD_PLUG_RESOLVERS[plug.plug_type];
  if (!resolver) return null;
  return resolver(plug);
}
