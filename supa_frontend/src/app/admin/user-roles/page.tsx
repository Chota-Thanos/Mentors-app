"use client";

import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { RefreshCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import AdminOnly from "@/components/auth/AdminOnly";
import AppLayout from "@/components/layouts/AppLayout";
import { premiumApi } from "@/lib/premiumApi";
import { toDisplayRoleLabel } from "@/lib/roleLabels";
import type { AdminUserRoleRecord, ManagedUserRole } from "@/types/premium";

const MANAGED_ROLE_OPTIONS: ManagedUserRole[] = [
  "admin",
  "moderator",
  "provider",
  "institute",
  "creator",
  "mentor",
  "subscriber",
  "user",
];

const toError = (error: unknown): string => {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
};

const roleOptionLabel = (role: ManagedUserRole): string => {
  if (role === "creator" || role === "provider" || role === "institute" || role === "mentor") {
    return `${toDisplayRoleLabel(role)} (${role})`;
  }
  return role;
};

export default function AdminUserRolesPage() {
  const [rows, setRows] = useState<AdminUserRoleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [savingByUserId, setSavingByUserId] = useState<Record<string, boolean>>({});

  const loadRoles = async () => {
    setLoading(true);
    try {
      const response = await premiumApi.get<AdminUserRoleRecord[]>("/admin/users/roles", {
        params: {
          search: search.trim() || undefined,
          page: 1,
          per_page: 300,
        },
      });
      const data = Array.isArray(response.data) ? response.data : [];
      setRows(data);
    } catch (error: unknown) {
      setRows([]);
      toast.error("Failed to load users", { description: toError(error) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((left, right) => {
      const roleDiff = String(left.role || "").localeCompare(String(right.role || ""));
      if (roleDiff !== 0) return roleDiff;
      return String(left.email || left.user_id).localeCompare(String(right.email || right.user_id));
    });
    return copy;
  }, [rows]);

  const updateRole = async (userId: string, role: ManagedUserRole) => {
    setSavingByUserId((prev) => ({ ...prev, [userId]: true }));
    try {
      const response = await premiumApi.put<AdminUserRoleRecord>(`/admin/users/${userId}/role`, { role });
      const updated = response.data;
      setRows((prev) => prev.map((row) => (row.user_id === userId ? updated : row)));
      toast.success(`Role updated to ${role}`);
    } catch (error: unknown) {
      toast.error("Failed to update role", { description: toError(error) });
    } finally {
      setSavingByUserId((prev) => ({ ...prev, [userId]: false }));
    }
  };

  return (
    <AdminOnly>
      <AppLayout adminNav>
        <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h1 className="inline-flex items-center gap-2 text-2xl font-bold text-slate-900">
                  <ShieldCheck className="h-6 w-6" /> User Role Management
                </h1>
                <p className="mt-1 text-sm text-slate-600">Assign system roles for admin, moderation, Quiz Master, and Mains Mentor workflows.</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="Search by user/email/role"
                />
                <button
                  type="button"
                  onClick={() => void loadRoles()}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
                >
                  <RefreshCcw className="h-4 w-4" /> Refresh
                </button>
              </div>
            </div>
          </section>

          <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Last Sign In</th>
                  <th className="px-3 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-500">Loading users...</td>
                  </tr>
                ) : null}

                {!loading && sortedRows.map((row) => {
                  const normalizedRole = String(row.role || "user") as ManagedUserRole;
                  const currentRole = MANAGED_ROLE_OPTIONS.includes(normalizedRole) ? normalizedRole : "user";
                  const saving = Boolean(savingByUserId[row.user_id]);
                  return (
                    <tr key={row.user_id} className="border-t border-slate-100">
                      <td className="px-3 py-2 align-top">
                        <p className="font-medium text-slate-900">{row.email || "No email"}</p>
                        <p className="text-xs text-slate-500">{row.user_id}</p>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex items-center gap-2">
                          <select
                            value={currentRole}
                            onChange={(event) => void updateRole(row.user_id, event.target.value as ManagedUserRole)}
                            disabled={saving}
                            className="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-60"
                          >
                            {MANAGED_ROLE_OPTIONS.map((role) => (
                              <option key={role} value={role}>{roleOptionLabel(role)}</option>
                            ))}
                          </select>
                          {saving ? <span className="text-xs text-slate-500">Saving...</span> : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-slate-600">{row.last_sign_in_at ? new Date(row.last_sign_in_at).toLocaleString() : "-"}</td>
                      <td className="px-3 py-2 align-top text-xs text-slate-600">{row.created_at ? new Date(row.created_at).toLocaleString() : "-"}</td>
                    </tr>
                  );
                })}

                {!loading && sortedRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-500">No users found for current filter.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>
        </div>
      </AppLayout>
    </AdminOnly>
  );
}
