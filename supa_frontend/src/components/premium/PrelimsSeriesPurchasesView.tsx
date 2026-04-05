"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Calendar,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  RefreshCcw,
  ShieldOff,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import HistoryBackButton from "@/components/ui/HistoryBackButton";
import RoleWorkspaceSidebar from "@/components/layouts/RoleWorkspaceSidebar";
import { getQuizMasterWorkspaceSections } from "@/components/layouts/roleWorkspaceLinks";
import { useAuth } from "@/context/AuthContext";
import { isAdminLike, isProviderLike } from "@/lib/accessControl";
import { premiumApi } from "@/lib/premiumApi";
import type { TestSeries, TestSeriesEnrollment } from "@/types/premium";

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function maskUserId(userId: string): string {
  if (!userId || userId.length < 8) return userId || "—";
  return `${userId.slice(0, 6)}••••${userId.slice(-4)}`;
}

function accessSourceLabel(source: string): string {
  const map: Record<string, string> = {
    self_service: "Self-Service",
    admin: "Admin Grant",
    subscription: "Subscription",
    payment: "Direct Payment",
    manual: "Manual",
    coupon: "Coupon",
  };
  const normalized = String(source || "").trim().toLowerCase();
  return map[normalized] ?? source.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusBadge(status: string) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "active")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-800">
        <BadgeCheck className="h-3.5 w-3.5" />
        Active
      </span>
    );
  if (normalized === "cancelled")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-rose-700">
        <XCircle className="h-3.5 w-3.5" />
        Cancelled
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-800">
      <ShieldOff className="h-3.5 w-3.5" />
      {status || "Unknown"}
    </span>
  );
}

type SortKey = "date" | "status" | "source";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 20;

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color: "sky" | "emerald" | "rose" | "indigo";
}) {
  const colorClasses = {
    sky: "border-sky-200 bg-sky-50/70 text-sky-900",
    emerald: "border-emerald-200 bg-emerald-50/70 text-emerald-900",
    rose: "border-rose-200 bg-rose-50/70 text-rose-900",
    indigo: "border-indigo-200 bg-indigo-50/70 text-indigo-900",
  };
  return (
    <article className={`rounded-[24px] border p-5 shadow-sm ${colorClasses[color]}`}>
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] opacity-70">{label}</p>
      <p className="mt-3 text-3xl font-black tracking-tight">{value}</p>
      {sub ? <p className="mt-2 text-xs font-semibold opacity-60">{sub}</p> : null}
    </article>
  );
}

export default function PrelimsSeriesPurchasesView({ seriesId }: { seriesId: number }) {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const adminLike = useMemo(() => isAdminLike(user), [user]);
  const providerLike = useMemo(() => isProviderLike(user), [user]);
  const currentUserId = String(user?.id || "").trim();

  const workspaceSections = useMemo(
    () => getQuizMasterWorkspaceSections(currentUserId || undefined),
    [currentUserId],
  );

  const [busy, setBusy] = useState(true);
  const [series, setSeries] = useState<TestSeries | null>(null);
  const [enrollments, setEnrollments] = useState<TestSeriesEnrollment[]>([]);

  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "cancelled">("all");

  const loadData = async () => {
    setBusy(true);
    try {
      const [seriesRes, enrollmentsRes] = await Promise.all([
        premiumApi.get<TestSeries>(`/programs/${seriesId}`),
        premiumApi.get<TestSeriesEnrollment[]>(`/programs/${seriesId}/enrollments`),
      ]);
      setSeries(seriesRes.data);
      setEnrollments(Array.isArray(enrollmentsRes.data) ? enrollmentsRes.data : []);
    } catch (error: unknown) {
      toast.error("Failed to load purchases", { description: toError(error) });
      setSeries(null);
      setEnrollments([]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setBusy(false);
      return;
    }
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesId, authLoading, isAuthenticated]);

  const canAccess = useMemo(() => {
    if (!series) return false;
    if (adminLike) return true;
    if (!currentUserId) return false;
    return providerLike && series.provider_user_id === currentUserId;
  }, [series, adminLike, providerLike, currentUserId]);

  const stats = useMemo(() => {
    const total = enrollments.length;
    const active = enrollments.filter((e) => e.status === "active").length;
    const cancelled = enrollments.filter((e) => e.status === "cancelled").length;
    const other = total - active - cancelled;

    const bySources: Record<string, number> = {};
    for (const e of enrollments) {
      const s = String(e.access_source || "unknown").trim().toLowerCase();
      bySources[s] = (bySources[s] ?? 0) + 1;
    }
    return { total, active, cancelled, other, bySources };
  }, [enrollments]);

  const filtered = useMemo(() => {
    let rows = [...enrollments];
    if (statusFilter !== "all") rows = rows.filter((e) => e.status === statusFilter);
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") {
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      } else if (sortKey === "status") {
        cmp = String(a.status).localeCompare(String(b.status));
      } else if (sortKey === "source") {
        cmp = String(a.access_source).localeCompare(String(b.access_source));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [enrollments, sortKey, sortDir, statusFilter]);

  const paginated = useMemo(
    () => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filtered, page],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return null;
    return sortDir === "asc" ? (
      <ChevronUp className="h-3.5 w-3.5" />
    ) : (
      <ChevronDown className="h-3.5 w-3.5" />
    );
  }

  if (authLoading || busy) {
    return (
      <div className="flex items-center justify-center rounded-[32px] border border-slate-200 bg-white p-16">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        Sign in to view purchase data.
      </div>
    );
  }

  if (!series) {
    return (
      <div className="rounded-[28px] border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        Series not found or inaccessible.
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        You do not have access to this series&apos; purchase data.
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 lg:flex-row">
      <RoleWorkspaceSidebar
        title="Prelims Expert Workspace"
        subtitle="Program control, quiz authoring, and learner analytics."
        sections={workspaceSections}
        className="lg:self-start"
      />

      <div className="min-w-0 flex-1 space-y-6">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-[34px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="pointer-events-none absolute right-0 top-0 h-full w-full opacity-40 bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.15),_transparent_50%)]" />
          <div className="relative">
            <HistoryBackButton
              fallbackHref={`/programs/${seriesId}/manage`}
              label="Back to workspace"
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
              iconClassName="h-3 w-3"
            />
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">
              Purchases & Enrollments
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl text-balance">
              {series.title}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600">
              All learner enrollments for this prelims program. Filter by status, sort by date or source,
              and track how learners are accessing the series.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void loadData()}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </button>
              <Link
                href={`/programs/${seriesId}/manage`}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                <ArrowLeft className="h-4 w-4" />
                Builder
              </Link>
            </div>
          </div>
        </section>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Total Purchases" value={stats.total} color="sky" sub="All enrollments ever" />
          <StatCard
            label="Active"
            value={stats.active}
            color="emerald"
            sub={stats.total > 0 ? `${Math.round((stats.active / stats.total) * 100)}% of total` : undefined}
          />
          <StatCard label="Cancelled" value={stats.cancelled} color="rose" />
          <StatCard label="Other Status" value={stats.other} color="indigo" sub="Pending / unknown" />
        </div>

        {/* Source breakdown */}
        {Object.keys(stats.bySources).length > 0 && (
          <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Access Source Breakdown</p>
                <p className="mt-0.5 text-lg font-black tracking-tight text-slate-900">How learners enrolled</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              {Object.entries(stats.bySources)
                .sort((a, b) => b[1] - a[1])
                .map(([source, count]) => (
                  <div
                    key={source}
                    className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3"
                  >
                    <p className="text-sm font-bold text-slate-900">{accessSourceLabel(source)}</p>
                    <span className="inline-flex h-6 items-center justify-center rounded-full bg-indigo-950 px-2.5 text-xs font-black text-white">
                      {count}
                    </span>
                  </div>
                ))}
            </div>
          </section>
        )}

        {/* Table */}
        <section className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-sky-50 p-2.5 text-sky-600">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Enrollments</p>
                <p className="mt-0.5 text-lg font-black tracking-tight text-slate-900">
                  {filtered.length} record{filtered.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>

            {/* Filter */}
            <div className="flex flex-wrap gap-2">
              {(["all", "active", "cancelled"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => { setStatusFilter(f); setPage(0); }}
                  className={`rounded-2xl border px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] transition ${
                    statusFilter === f
                      ? "border-indigo-950 bg-indigo-950 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {f === "all" ? `All (${stats.total})` : f === "active" ? `Active (${stats.active})` : `Cancelled (${stats.cancelled})`}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-12 text-center text-slate-500">
              <Download className="h-10 w-10 text-slate-300" />
              <p className="font-semibold text-slate-700">No enrollments found</p>
              <p className="text-sm">No learners have enrolled in this program yet, or none match this filter.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      <th className="px-6 py-4 text-left text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                        #
                      </th>
                      <th className="px-4 py-4 text-left text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                        User
                      </th>
                      <th className="px-4 py-4 text-left">
                        <button
                          type="button"
                          onClick={() => toggleSort("status")}
                          className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 hover:text-slate-800 transition"
                        >
                          Status <SortIcon k="status" />
                        </button>
                      </th>
                      <th className="px-4 py-4 text-left">
                        <button
                          type="button"
                          onClick={() => toggleSort("source")}
                          className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 hover:text-slate-800 transition"
                        >
                          Source <SortIcon k="source" />
                        </button>
                      </th>
                      <th className="px-4 py-4 text-left">
                        <button
                          type="button"
                          onClick={() => toggleSort("date")}
                          className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 hover:text-slate-800 transition"
                        >
                          Enrolled <SortIcon k="date" />
                        </button>
                      </th>
                      <th className="px-4 py-4 text-left text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                        Expires
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginated.map((enrollment, idx) => (
                      <tr
                        key={enrollment.id}
                        className="group transition hover:bg-slate-50/60"
                      >
                        <td className="px-6 py-4 text-xs font-semibold text-slate-400">
                          {page * PAGE_SIZE + idx + 1}
                        </td>
                        <td className="px-4 py-4">
                          <p className="font-mono text-xs font-semibold text-slate-700">
                            {maskUserId(enrollment.user_id)}
                          </p>
                        </td>
                        <td className="px-4 py-4">{statusBadge(enrollment.status)}</td>
                        <td className="px-4 py-4">
                          <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                            {accessSourceLabel(enrollment.access_source)}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                            <Calendar className="h-3.5 w-3.5 text-slate-400" />
                            {formatDate(enrollment.created_at)}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-xs text-slate-500">
                          {enrollment.subscribed_until ? formatDate(enrollment.subscribed_until) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
                  <p className="text-xs text-slate-500">
                    Page {page + 1} of {totalPages} · {filtered.length} total
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={page === 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40 hover:bg-slate-50 transition"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40 hover:bg-slate-50 transition"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
