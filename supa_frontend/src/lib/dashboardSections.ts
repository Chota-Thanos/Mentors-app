import type { LucideIcon } from "lucide-react";
import { BookOpen, Brain, Calculator, ScrollText } from "lucide-react";

export type DashboardContentType = "gk" | "maths" | "passage" | "mains";

export const DASHBOARD_CONTENT_TYPES: DashboardContentType[] = ["gk", "maths", "passage", "mains"];

export const DASHBOARD_SECTION_META: Record<
  DashboardContentType,
  {
    label: string;
    icon: LucideIcon;
    tone: string;
    chartStroke: string;
  }
> = {
  gk: {
    label: "GK Quiz",
    icon: BookOpen,
    tone: "text-sky-700 bg-sky-50 border-sky-200",
    chartStroke: "#2563eb",
  },
  maths: {
    label: "Maths Quiz",
    icon: Calculator,
    tone: "text-emerald-700 bg-emerald-50 border-emerald-200",
    chartStroke: "#059669",
  },
  passage: {
    label: "Passage Quiz",
    icon: ScrollText,
    tone: "text-amber-700 bg-amber-50 border-amber-200",
    chartStroke: "#d97706",
  },
  mains: {
    label: "Mains",
    icon: Brain,
    tone: "text-violet-700 bg-violet-50 border-violet-200",
    chartStroke: "#7c3aed",
  },
};

export function isDashboardContentType(value: string): value is DashboardContentType {
  return DASHBOARD_CONTENT_TYPES.includes(value as DashboardContentType);
}
