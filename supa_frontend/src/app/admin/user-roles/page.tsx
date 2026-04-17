/**
 * V2 Admin User Roles Page
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import AdminOnly from "@/components/auth/AdminOnly";
import AppLayout from "@/components/layouts/AppLayout";
import { profilesApi } from "@/lib/backendServices";
import { getRoleBadgeColor, getRoleLabel } from "@/lib/accessControl";
import type { UserRole } from "@/types/db";

const ROLE_OPTIONS: UserRole[] = ["admin", "moderator", "prelims_expert", "mains_expert", "user"];

interface UserRoleRow {
  id: number;
  auth_user_id: string;
  display_name: string;
  email: string;
  role: UserRole;
  created_at: string;
}

export default function AdminUserRolesPage() {
  const [rows, setRows] = useState<UserRoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [savingById, setSavingById] = useState<Record<number, boolean>>({});

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await profilesApi.all();
      const term = search.trim().toLowerCase();
      const filtered = term
        ? data.filter((row) =>
            row.display_name?.toLowerCase().includes(term) ||
            row.email?.toLowerCase().includes(term) ||
            row.role?.toLowerCase().includes(term),
          )
        : data;
      setRows(filtered as UserRoleRow[]);
    } catch (err) {
      toast.error("Failed to load users", {
        description: String((err as Error).message),
      });
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateRole = async (profileId: number, role: UserRole) => {
    setSavingById((prev) => ({ ...prev, [profileId]: true }));
    try {
      await profilesApi.updateRole(profileId, role);
      setRows((prev) => prev.map((row) => (row.id === profileId ? { ...row, role } : row)));
      toast.success(`Role updated to: ${getRoleLabel(role)}`);
    } catch (err) {
      toast.error("Failed to update role", {
        description: String((err as Error).message),
      });
    } finally {
      setSavingById((prev) => ({ ...prev, [profileId]: false }));
    }
  };

  const sortedRows = useMemo(() => [...rows], [rows]);

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
                <p className="mt-1 text-sm text-slate-600">
                  Assign V2 roles: admin, moderator, prelims_expert, mains_expert, user.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void loadUsers()}
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="Search name / email / role"
                />
                <button
                  type="button"
                  onClick={() => void loadUsers()}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
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
                  <th className="px-3 py-2">Current Role</th>
                  <th className="px-3 py-2">Change Role</th>
                  <th className="px-3 py-2">Joined</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                      Loading users...
                    </td>
                  </tr>
                )}

                {!loading && sortedRows.map((row) => {
                  const saving = Boolean(savingById[row.id]);
                  return (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-3 py-3">
                        <div className="font-medium text-slate-900">{row.display_name}</div>
                        <div className="text-xs text-slate-500">{row.email}</div>
                        <div className="text-[11px] text-slate-400">#{row.id} · {row.auth_user_id}</div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${getRoleBadgeColor(row.role)}`}>
                          {getRoleLabel(row.role)}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <select
                          value={row.role}
                          disabled={saving}
                          onChange={(e) => void updateRole(row.id, e.target.value as UserRole)}
                          className="rounded border border-slate-300 px-2 py-1 text-sm"
                        >
                          {ROLE_OPTIONS.map((role) => (
                            <option key={role} value={role}>
                              {getRoleLabel(role)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-3 text-slate-500">
                        {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
                      </td>
                    </tr>
                  );
                })}

                {!loading && sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                      No users found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
      </AppLayout>
    </AdminOnly>
  );
}
