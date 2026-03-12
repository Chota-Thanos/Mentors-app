"use client";

import { lifecycleCompletionPercent, type UserLifecycleMetrics, buildLifecycleSteps } from "@/lib/testSeriesLifecycle";

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

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-slate-900">User Lifecycle</h3>
        <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-800">
          {completion}% complete
        </span>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${completion}%` }} />
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step) => (
          <div key={step.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">{step.label}</p>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${statusPillClass(step.status)}`}>
                {statusLabel(step.status)}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-600">{step.description}</p>
            <p className="mt-2 text-xs font-medium text-slate-500">Count: {step.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
