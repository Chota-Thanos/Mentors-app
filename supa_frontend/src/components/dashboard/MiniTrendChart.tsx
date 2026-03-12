"use client";

import type { DashboardTrendPoint } from "@/types/premium";

export default function MiniTrendChart({
  title,
  points,
  yMax,
  stroke,
  formatValue,
}: {
  title: string;
  points: DashboardTrendPoint[];
  yMax: number;
  stroke: string;
  formatValue: (value: number) => string;
}) {
  const width = 240;
  const height = 78;
  const pad = 8;
  const safeMax = yMax > 0 ? yMax : 100;
  const usableWidth = width - pad * 2;
  const usableHeight = height - pad * 2;
  const chartPoints = points.length > 0 ? points : [{ date: "", label: "", value: 0, activity_count: 0 }];
  const coords = chartPoints.map((point, index) => {
    const x = pad + (chartPoints.length <= 1 ? 0 : (usableWidth * index) / (chartPoints.length - 1));
    const normalized = Math.max(0, Math.min(safeMax, Number(point.value || 0)));
    const y = pad + usableHeight - (normalized / safeMax) * usableHeight;
    return { x, y, value: normalized, label: point.label };
  });
  const polyline = coords.map((coord) => `${coord.x},${coord.y}`).join(" ");
  const first = coords[0]?.value ?? 0;
  const last = coords[coords.length - 1]?.value ?? 0;
  const delta = last - first;
  const deltaText = `${delta >= 0 ? "+" : ""}${formatValue(delta)}`;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
        <div className="text-right">
          <p className="text-xs font-bold text-slate-900">{formatValue(last)}</p>
          <p className={`text-[11px] ${delta >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{deltaText}</p>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-20 w-full">
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#cbd5e1" strokeWidth="1" />
        <polyline fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={polyline} />
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
        <span>{coords[0]?.label || "Start"}</span>
        <span>{coords[coords.length - 1]?.label || "Now"}</span>
      </div>
    </div>
  );
}
