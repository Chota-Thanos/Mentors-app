"use client";

import { lifecycleCompletionPercent, type UserLifecycleMetrics, buildLifecycleSteps } from "@/lib/testSeriesLifecycle";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";

const statusPillClass = (status: "locked" | "ready" | "in_progress" | "completed"): string => {
  if (status === "completed") return "bg-emerald-100 text-emerald-800";
  if (status === "in_progress") return "bg-amber-100 text-amber-800";
  if (status === "ready") return "bg-blue-100 text-blue-800";
  return "bg-slate-100 text-slate-500";
};

const statusLabel = (status: "locked" | "ready" | "in_progress" | "completed"): string => {
  if (status === "completed") return "Completed";
  if (status === "in_progress") return "In Progress";
  if (status === "ready") return "Ready";
  return "Locked";
};

interface UserLifecycleBoardProps {
  metrics: UserLifecycleMetrics;
}

export default function UserLifecycleBoard({ metrics }: UserLifecycleBoardProps) {
  const steps = buildLifecycleSteps(metrics);
  const completion = lifecycleCompletionPercent(metrics);
  const activeStep = steps.find(s => s.status === "in_progress" || s.status === "ready") || steps[steps.length - 1];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>User Lifecycle</CardTitle>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {completion}%
          </span>
          <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-800">
            Current: {activeStep.label}
          </span>
        </div>
      </CardHeader>

      <CardContent>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${completion}%` }} />
        </div>

        <div className="mt-4 flex snap-x snap-mandatory flex-nowrap gap-2 overflow-x-auto pb-2 text-xs scrollbar-hide">
          {steps.map((step) => (
            <div key={step.key} className="flex shrink-0 snap-start items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 transition hover:bg-slate-100">
              <span className="font-medium text-slate-900">{step.label}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${statusPillClass(step.status)}`}>
                {statusLabel(step.status)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
