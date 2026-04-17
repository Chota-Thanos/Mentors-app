/**
 * V2 Admin User Roles Page
 * 
 * In V2, roles are stored on public.profiles.role (not auth.users metadata).
 * This page directly queries + updates profiles.role via Supabase.
 * No backend API call needed — admin client handles this via service role.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import AdminOnly from "@/components/auth/AdminOnly";
import AppLayout from "@/components/layouts/AppLayout";
import { createClient } from "@/lib/supabase/client";
import { getRoleLabel, getRoleBadgeColor } from "@/lib/accessControl";
import type { UserRole } from "@/types/db";

const V2_ROLE_OPTIONS: UserRole[] = [
  "admin",
  "moderator",
  "prelims_expert",
  "mains_expert",
  "user",
];

interface UserRoleRow {
  id: number;
  auth_user_id: string;
  display_name: string;
  email: string;
  role: UserRole;
  created_at: string;
}

export default function AdminUserRolesPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<UserRoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [savingById, setSavingById] = useState<Record<number, boolean>>({});

  const loadUsers = async () => {
    setLoading(true);
    try {
      // Query profiles directly — V2 stores role on profiles table
      let q = supabase
        .from("profiles")
        .select("id, auth_user_id, display_name, email, role, created_at")
        .order("role")
        .order("display_name")
        .limit(300);

      if (search.trim()) {
        q = q.or(
          `display_name.ilike.%${search.trim()}%,email.ilike.%${search.trim()}%,role.eq.${search.trim()}`,
        );
      }

      const { data, error } = await q;
      if (error) throw error;
      setRows((data ?? []) as UserRoleRow[]);
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
      const { error } = await supabase
        .from("profiles")
        .update({ role })
        .eq("id", profileId);

      if (error) throw error;

      setRows((prev) =>
        prev.map((row) => (row.id === profileId ? { ...row, role } : row)),
      );
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
                      Loading users…
                    </td>
                  </tr>
                )}

                {!loading &&
                  sortedRows.map((row) => {
                    const saving = Boolean(savingById[row.id]);
                    return (
                      <tr key={row.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 align-top">
                          <p className="font-medium text-slate-900">
                            {row.display_name || "No name"}
                          </p>
                          <p className="text-xs text-slate-500">{row.email}</p>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${getRoleBadgeColor(row.role)}`}
                          >
                            {getRoleLabel(row.role)}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex items-center gap-2">
                            <select
                              value={row.role}
                              onChange={(e) =>
                                void updateRole(row.id, e.target.value as UserRole)
                              }
                              disabled={saving}
                              className="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-60"
                            >
                              {V2_ROLE_OPTIONS.map((r) => (
                                <option key={r} value={r}>
                                  {getRoleLabel(r)}
                                </option>
                              ))}
                            </select>
                            {saving && (
                              <span className="text-xs text-slate-500">Saving…</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-slate-600">
                          {row.created_at
                            ? new Date(row.created_at).toLocaleDateString("en-IN")
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}

                {!loading && sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                      No users found.
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
